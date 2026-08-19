const GITHUB_API = "https://api.github.com";
const FIRST_REPOSITORY_DATE = new Date(
  "2008-01-01T00:00:00.000Z",
);
const SEARCH_SPLIT_THRESHOLD = 900;
const SEARCH_PAGE_SIZE = 100;
const SEARCH_PAGE_LIMIT = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_ATTEMPTS = 3;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const REPOSITORY_FULL_NAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;

export interface GitHubRepository {
  id: number;
  fullName: string;
  repositoryUrl: string;
  description: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushedAt: string | null;
  defaultBranch: string;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
}

export interface GitHubTree {
  sha: string;
  truncated: boolean;
  entries: GitHubTreeEntry[];
}

export interface GitHubCatalogSourceOptions {
  fetcher: (
    input: string,
    init?: RequestInit,
  ) => Promise<Response>;
  token: string | undefined;
  topic: string;
  signal: AbortSignal;
  delay: (milliseconds: number) => Promise<void>;
  searchPaceMs: number;
  requestTimeoutMs?: number;
}

interface SearchPage {
  total: number;
  incomplete: boolean;
  repositories: GitHubRepository[];
}

export class GitHubResponseError extends Error {
  readonly status: number;

  constructor(
    status: number,
    message = `GitHub request failed (${String(status)})`,
  ) {
    super(message);
    this.name = "GitHubResponseError";
    this.status = status;
  }
}

export class GitHubRequestTimeoutError extends Error {
  constructor(milliseconds: number) {
    super(
      `GitHub request timed out after ${String(milliseconds)} ms`,
    );
    this.name = "GitHubRequestTimeoutError";
  }
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function parseRepository(value: unknown): GitHubRepository | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.owner !== "object" ||
    row.owner === null ||
    Array.isArray(row.owner)
  ) {
    return null;
  }
  const owner = row.owner as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.id) ||
    Number(row.id) <= 0 ||
    typeof row.full_name !== "string" ||
    !REPOSITORY_FULL_NAME.test(row.full_name) ||
    typeof row.default_branch !== "string" ||
    row.default_branch.length === 0 ||
    row.fork !== false ||
    row.archived !== false ||
    row.disabled !== false ||
    typeof owner.login !== "string" ||
    owner.login.toLocaleLowerCase("en-US") !==
      row.full_name
        .split("/", 1)[0]
        .toLocaleLowerCase("en-US")
  ) {
    return null;
  }
  const topics = Array.isArray(row.topics)
    ? row.topics.filter(
        (topic): topic is string => typeof topic === "string",
      )
    : [];
  return {
    id: Number(row.id),
    fullName: row.full_name,
    repositoryUrl: `https://github.com/${row.full_name}`,
    description:
      typeof row.description === "string"
        ? row.description.trim()
        : "",
    topics,
    language: nullableString(row.language),
    stars: Number.isSafeInteger(row.stargazers_count)
      ? Math.max(0, Number(row.stargazers_count))
      : 0,
    pushedAt: nullableString(row.pushed_at),
    defaultBranch: row.default_branch,
  };
}

function parseTreeEntry(value: unknown): GitHubTreeEntry | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.path !== "string" ||
    typeof row.mode !== "string" ||
    (row.type !== "blob" && row.type !== "tree") ||
    typeof row.sha !== "string" ||
    row.sha.length === 0
  ) {
    return null;
  }
  return {
    path: row.path,
    mode: row.mode,
    type: row.type,
    sha: row.sha,
  };
}

function timestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 60_000);
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(
      Math.max(1_000, reset * 1_000 - Date.now() + 1_000),
      60_000,
    );
  }
  return 1_000 * 2 ** attempt;
}

function responseIsRetryable(response: Response): boolean {
  return (
    response.status === 429 ||
    response.status >= 500 ||
    (
      response.status === 403 &&
      (
        response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")
      )
    )
  );
}

/** Read-only GitHub adapter used by the local catalog module. */
export class GitHubCatalogSource {
  readonly #fetcher: GitHubCatalogSourceOptions["fetcher"];
  readonly #token: string | undefined;
  readonly #topic: string;
  readonly #signal: AbortSignal;
  readonly #delay: GitHubCatalogSourceOptions["delay"];
  readonly #searchPaceMs: number;
  readonly #requestTimeoutMs: number;

  #lastSearchAt = 0;
  #coreRemaining: number | undefined;

  constructor(options: GitHubCatalogSourceOptions) {
    this.#fetcher = options.fetcher;
    this.#token = options.token;
    this.#topic = options.topic;
    this.#signal = options.signal;
    this.#delay = options.delay;
    this.#searchPaceMs = options.searchPaceMs;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0
    ) {
      throw new TypeError(
        "GitHub request timeout must be a positive integer",
      );
    }
  }

  get coreRemaining(): number | undefined {
    return this.#coreRemaining;
  }

  async discoverFull(to: Date): Promise<GitHubRepository[]> {
    return await this.#discover([
      ["created", FIRST_REPOSITORY_DATE, to],
    ]);
  }

  async discoverIncremental(
    from: Date,
    to: Date,
  ): Promise<GitHubRepository[]> {
    return await this.#discover([
      ["created", from, to],
      ["pushed", from, to],
    ]);
  }

  async tree(
    repository: GitHubRepository,
    revision = repository.defaultBranch,
  ): Promise<GitHubTree> {
    const body = object(
      await this.#requestJson(
        `/repos/${repository.fullName}/git/trees/${encodeURIComponent(revision)}?recursive=1`,
      ),
      "GitHub tree",
    );
    if (
      typeof body.sha !== "string" ||
      !Array.isArray(body.tree) ||
      typeof body.truncated !== "boolean"
    ) {
      throw new TypeError("GitHub tree response is incomplete");
    }
    return {
      sha: body.sha,
      truncated: body.truncated === true,
      entries: body.tree
        .map(parseTreeEntry)
        .filter(
          (entry): entry is GitHubTreeEntry => entry !== null,
        ),
    };
  }

  async blob(
    repository: GitHubRepository,
    sha: string,
  ): Promise<string> {
    const body = object(
      await this.#requestJson(
        `/repos/${repository.fullName}/git/blobs/${encodeURIComponent(
          sha,
        )}`,
      ),
      "GitHub blob",
    );
    if (
      body.encoding !== "base64" ||
      typeof body.content !== "string"
    ) {
      throw new TypeError("GitHub blob is not base64 encoded");
    }
    const encoded = body.content.replaceAll("\n", "");
    if (
      encoded.length >
      Math.ceil(MAX_MANIFEST_BYTES / 3) * 4 + 4
    ) {
      throw new Error("GitHub manifest blob is too large");
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error("GitHub manifest blob is too large");
    }
    return decoded.toString("utf8");
  }

  async #discover(
    ranges: Array<
      ["created" | "pushed", Date, Date]
    >,
  ): Promise<GitHubRepository[]> {
    const repositories = new Map<number, GitHubRepository>();
    for (const [qualifier, from, to] of ranges) {
      if (from.getTime() > to.getTime()) continue;
      for (
        const repository of await this.#searchRange(
          qualifier,
          from,
          to,
        )
      ) {
        repositories.set(repository.id, repository);
      }
    }
    return [...repositories.values()];
  }

  async #searchRange(
    qualifier: "created" | "pushed",
    from: Date,
    to: Date,
  ): Promise<GitHubRepository[]> {
    const query = [
      `topic:${this.#topic}`,
      "is:public",
      "fork:false",
      "archived:false",
      `${qualifier}:${timestamp(from)}..${timestamp(to)}`,
    ].join(" ");
    const first = await this.#searchPage(query, 1);
    if (first.incomplete) {
      throw new Error("GitHub repository search was incomplete");
    }
    if (first.total < SEARCH_SPLIT_THRESHOLD) {
      const repositories = [...first.repositories];
      const pages = Math.min(
        SEARCH_PAGE_LIMIT,
        Math.ceil(first.total / SEARCH_PAGE_SIZE),
      );
      for (let page = 2; page <= pages; page += 1) {
        const next = await this.#searchPage(query, page);
        if (next.incomplete) {
          throw new Error("GitHub repository search was incomplete");
        }
        repositories.push(...next.repositories);
        if (next.repositories.length < SEARCH_PAGE_SIZE) break;
      }
      return repositories;
    }

    if (to.getTime() - from.getTime() < 1_000) {
      throw new Error(
        "GitHub repository search cannot be split without truncation",
      );
    }

    const midpoint = new Date(
      Math.floor(
        (from.getTime() + to.getTime()) / 2_000,
      ) * 1_000,
    );
    const left = await this.#searchRange(
      qualifier,
      from,
      midpoint,
    );
    const right = await this.#searchRange(
      qualifier,
      new Date(midpoint.getTime() + 1_000),
      to,
    );
    return [...left, ...right];
  }

  async #searchPage(
    query: string,
    page: number,
  ): Promise<SearchPage> {
    const parameters = new URLSearchParams({
      q: query,
      per_page: String(SEARCH_PAGE_SIZE),
      page: String(page),
    });
    const body = object(
      await this.#requestJson(
        `/search/repositories?${parameters.toString()}`,
        true,
      ),
      "GitHub search response",
    );
    if (
      !Number.isSafeInteger(body.total_count) ||
      !Array.isArray(body.items) ||
      typeof body.incomplete_results !== "boolean"
    ) {
      throw new TypeError("GitHub search response is incomplete");
    }
    return {
      total: Math.max(0, Number(body.total_count)),
      incomplete: body.incomplete_results === true,
      repositories: body.items
        .map(parseRepository)
        .filter(
          (
            repository,
          ): repository is GitHubRepository =>
            repository !== null,
        ),
    };
  }

  async #requestJson(
    path: string,
    search = false,
  ): Promise<unknown> {
    for (
      let attempt = 0;
      attempt < REQUEST_ATTEMPTS;
      attempt += 1
    ) {
      if (search) await this.#paceSearch();
      let response: Response;
      const timeout = AbortSignal.timeout(
        this.#requestTimeoutMs,
      );
      try {
        response = await this.#fetcher(
          `${GITHUB_API}${path}`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "Minke-plugin-catalog",
              ...(this.#token === undefined
                ? {}
                : {
                    Authorization: `Bearer ${this.#token}`,
                  }),
            },
            signal: AbortSignal.any([
              this.#signal,
              timeout,
            ]),
          },
        );
      } catch (error) {
        if (timeout.aborted && !this.#signal.aborted) {
          throw new GitHubRequestTimeoutError(
            this.#requestTimeoutMs,
          );
        }
        if (
          this.#signal.aborted ||
          attempt === REQUEST_ATTEMPTS - 1
        ) {
          throw error;
        }
        await this.#wait(1_000 * 2 ** attempt);
        continue;
      }
      this.#captureRate(response, search);
      if (response.ok) return await response.json();
      if (
        response.status === 429 ||
        (
          response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0"
        )
      ) {
        throw new GitHubResponseError(
          response.status,
          `GitHub API rate limit reached (${String(
            response.status,
          )})`,
        );
      }
      if (
        responseIsRetryable(response) &&
        attempt < REQUEST_ATTEMPTS - 1
      ) {
        await this.#wait(retryDelay(response, attempt));
        continue;
      }
      throw new GitHubResponseError(response.status);
    }
    throw new Error("GitHub request attempts exhausted");
  }

  #captureRate(response: Response, search: boolean): void {
    if (search) return;
    const remaining = Number(
      response.headers.get("x-ratelimit-remaining"),
    );
    if (Number.isFinite(remaining)) {
      this.#coreRemaining = Math.max(0, remaining);
    }
  }

  async #paceSearch(): Promise<void> {
    if (this.#searchPaceMs <= 0) return;
    const elapsed = Date.now() - this.#lastSearchAt;
    if (
      this.#lastSearchAt !== 0 &&
      elapsed < this.#searchPaceMs
    ) {
      await this.#wait(this.#searchPaceMs - elapsed);
    }
    this.#lastSearchAt = Date.now();
  }

  async #wait(milliseconds: number): Promise<void> {
    if (this.#signal.aborted) {
      throw this.#signal.reason;
    }
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(this.#signal.reason);
      this.#signal.addEventListener("abort", onAbort, {
        once: true,
      });
      removeAbortListener = () =>
        this.#signal.removeEventListener("abort", onAbort);
    });
    try {
      await Promise.race([
        this.#delay(milliseconds),
        aborted,
      ]);
    } finally {
      removeAbortListener();
    }
  }
}
