import {
  WEIXIN_DEFAULT_API_BASE_URL,
  WEIXIN_MAX_QR_CONTENT_BYTES,
  WeixinTransportError,
  type WeixinLoginChallenge,
  type WeixinLoginFlow,
  type WeixinLoginOptions,
  type WeixinLoginProgress,
} from "./contract.ts";
import {
  parseLoginStatusResponse,
  parseQrCodeResponse,
} from "./codec.ts";
import { WeixinNetwork } from "./network.ts";

const DEFAULT_QR_REQUEST_TIMEOUT_MS = 35_000;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 3;
const DEFAULT_BOT_TYPE = "3";
const MAX_QR_SECRET_BYTES = 4_096;

interface LoginChallengeState {
  readonly expiresAt: number;
  readonly qrContent: string;
  readonly secret: string;
}

function requestTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_QR_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new WeixinTransportError(
      "invalid-config",
      "requestTimeoutMs must be a positive integer",
    );
  }
  return timeout;
}

function botType(value: string | undefined): string {
  const result = value?.trim() || DEFAULT_BOT_TYPE;
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(result)) {
    throw new WeixinTransportError(
      "invalid-config",
      "botType contains unsupported characters",
    );
  }
  return result;
}

function verificationCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const result = value.trim();
  if (!/^[0-9]{1,32}$/u.test(result)) {
    throw new WeixinTransportError(
      "invalid-config",
      "verification code must contain only digits",
    );
  }
  return result;
}

function selectedKnownTokens(
  values: readonly string[] | undefined,
): string[] {
  return [...(values ?? [])]
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(-10);
}

function boundedLoginValue(
  value: string,
  label: string,
  maxBytes: number,
): string {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new WeixinTransportError(
      "protocol",
      `Weixin ${label} exceeds the supported size`,
    );
  }
  return value;
}

function redirectBaseUrl(
  network: WeixinNetwork,
  host: string | undefined,
): string {
  const value = host?.trim();
  if (
    !value ||
    value.includes("/") ||
    value.includes("@") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new WeixinTransportError(
      "protocol",
      "Weixin login redirect omitted a valid host",
    );
  }
  return network.trustedUrl(`https://${value}`).href;
}

class WeixinLoginFlowImplementation implements WeixinLoginFlow {
  readonly #botType: string;
  readonly #knownTokens: string[];
  readonly #network: WeixinNetwork;
  readonly #requestTimeoutMs: number;
  readonly #lifecycle = new AbortController();
  #externalAbort?: () => void;
  #externalSignal?: AbortSignal;

  #active = true;
  #apiBaseUrl = WEIXIN_DEFAULT_API_BASE_URL;
  #challengeCount = 0;
  #polling = false;
  #state: LoginChallengeState;

  private constructor(
    options: WeixinLoginOptions,
    network: WeixinNetwork,
    state: LoginChallengeState,
  ) {
    this.#botType = botType(options.botType);
    this.#knownTokens = selectedKnownTokens(
      options.knownBotTokens,
    );
    this.#network = network;
    this.#requestTimeoutMs = requestTimeout(
      options.requestTimeoutMs,
    );
    this.#state = state;
    this.#challengeCount = 1;
    if (options.signal !== undefined) {
      this.#externalSignal = options.signal;
      this.#externalAbort = () => this.close();
      if (options.signal.aborted) {
        this.close();
      } else {
        options.signal.addEventListener(
          "abort",
          this.#externalAbort,
          { once: true },
        );
      }
    }
  }

  static async begin(
    options: WeixinLoginOptions,
  ): Promise<WeixinLoginFlowImplementation> {
    const network = new WeixinNetwork(options);
    const initial = await fetchChallenge(
      network,
      botType(options.botType),
      selectedKnownTokens(options.knownBotTokens),
      requestTimeout(options.requestTimeoutMs),
      options.signal,
    );
    return new WeixinLoginFlowImplementation(
      options,
      network,
      initial,
    );
  }

  get challenge(): WeixinLoginChallenge {
    return Object.freeze({
      expiresAt: this.#state.expiresAt,
      qrContent: this.#state.qrContent,
    });
  }

  async poll(options: {
    readonly signal?: AbortSignal;
    readonly verificationCode?: string;
  } = {}): Promise<WeixinLoginProgress> {
    this.#assertActive();
    if (this.#polling) {
      throw new WeixinTransportError(
        "invalid-state",
        "only one Weixin login poll may be active",
      );
    }
    this.#polling = true;
    const signal =
      options.signal === undefined
        ? this.#lifecycle.signal
        : AbortSignal.any([
            this.#lifecycle.signal,
            options.signal,
          ]);
    try {
      if (Date.now() >= this.#state.expiresAt) {
        return await this.#refresh("expired", signal);
      }

      const code = verificationCode(options.verificationCode);
      const query = new URLSearchParams({
        qrcode: this.#state.secret,
      });
      if (code !== undefined) query.set("verify_code", code);

      let raw: unknown;
      try {
        raw = await this.#network.json({
          baseUrl: this.#apiBaseUrl,
          endpoint:
            `ilink/bot/get_qrcode_status?${query.toString()}`,
          method: "GET",
          signal,
          timeoutMs: this.#requestTimeoutMs,
        });
      } catch (error) {
        if (
          error instanceof WeixinTransportError &&
          error.code === "timeout"
        ) {
          return { status: "waiting" };
        }
        throw error;
      }

      const response = parseLoginStatusResponse(raw);
      switch (response.status) {
        case "wait":
          return { status: "waiting" };
        case "scaned":
          return { status: "scanned" };
        case "need_verifycode":
          return { status: "verification-required" };
        case "expired":
          return await this.#refresh("expired", signal);
        case "verify_code_blocked":
          return await this.#refresh(
            "verification-blocked",
            signal,
          );
        case "scaned_but_redirect":
          this.#apiBaseUrl = redirectBaseUrl(
            this.#network,
            response.redirect_host,
          );
          return { status: "scanned" };
        case "binded_redirect":
          this.close();
          return { status: "already-bound" };
        case "confirmed": {
          const accountId = response.ilink_bot_id?.trim();
          const token = response.bot_token?.trim();
          if (!accountId || !token?.trim()) {
            this.close();
            throw new WeixinTransportError(
              "protocol",
              "Weixin confirmed login without a complete grant",
            );
          }
          const baseUrl = this.#network.trustedUrl(
            response.baseurl?.trim() ||
              WEIXIN_DEFAULT_API_BASE_URL,
          ).href;
          const authorizedUserId =
            response.ilink_user_id?.trim() || undefined;
          this.close();
          return {
            status: "grant-issued",
            grant: {
              accountId,
              token,
              baseUrl,
              authorizedUserId,
            },
          };
        }
      }
    } finally {
      this.#polling = false;
    }
  }

  close(): void {
    if (
      this.#externalSignal !== undefined &&
      this.#externalAbort !== undefined
    ) {
      this.#externalSignal.removeEventListener(
        "abort",
        this.#externalAbort,
      );
    }
    this.#externalSignal = undefined;
    this.#externalAbort = undefined;
    this.#lifecycle.abort();
    this.#active = false;
    this.#state = {
      expiresAt: 0,
      qrContent: "",
      secret: "",
    };
    this.#knownTokens.fill("");
    this.#knownTokens.splice(0);
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new WeixinTransportError(
        "invalid-state",
        "Weixin login flow is closed",
      );
    }
  }

  async #refresh(
    reason: "expired" | "verification-blocked",
    signal: AbortSignal | undefined,
  ): Promise<WeixinLoginProgress> {
    if (this.#challengeCount >= MAX_CHALLENGES) {
      this.close();
      throw new WeixinTransportError(
        "invalid-state",
        "Weixin login challenge refresh limit was reached",
      );
    }
    this.#state = await fetchChallenge(
      this.#network,
      this.#botType,
      this.#knownTokens,
      this.#requestTimeoutMs,
      signal,
    );
    this.#apiBaseUrl = WEIXIN_DEFAULT_API_BASE_URL;
    this.#challengeCount += 1;
    return {
      status: "refreshed",
      challenge: this.challenge,
      reason,
    };
  }
}

async function fetchChallenge(
  network: WeixinNetwork,
  selectedBotType: string,
  knownTokens: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<LoginChallengeState> {
  const raw = await network.json({
    baseUrl: WEIXIN_DEFAULT_API_BASE_URL,
    body: JSON.stringify({ local_token_list: knownTokens }),
    endpoint:
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(selectedBotType)}`,
    method: "POST",
    signal,
    timeoutMs,
  });
  const response = parseQrCodeResponse(raw);
  const secret = boundedLoginValue(
    response.qrcode,
    "QR secret",
    MAX_QR_SECRET_BYTES,
  );
  const qrContent = boundedLoginValue(
    network.trustedUrl(
      boundedLoginValue(
        response.qrcode_img_content,
        "QR content",
        WEIXIN_MAX_QR_CONTENT_BYTES,
      ),
    ).href,
    "QR content",
    WEIXIN_MAX_QR_CONTENT_BYTES,
  );
  return {
    expiresAt: Date.now() + LOGIN_CHALLENGE_TTL_MS,
    qrContent,
    secret,
  };
}

export async function beginWeixinLogin(
  options: WeixinLoginOptions = {},
): Promise<WeixinLoginFlow> {
  return await WeixinLoginFlowImplementation.begin(options);
}
