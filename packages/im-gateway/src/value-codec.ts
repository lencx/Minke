import { createHash } from "node:crypto";
import type { GatewayCipher } from "./contract.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type EncodedValue =
  | readonly ["array", readonly EncodedValue[]]
  | readonly ["boolean", boolean]
  | readonly ["bytes", string]
  | readonly ["null"]
  | readonly ["number", number]
  | readonly [
      "object",
      readonly (readonly [string, EncodedValue])[],
    ]
  | readonly ["string", string];

function encodeNode(
  value: unknown,
  ancestors: Set<object>,
): EncodedValue {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Gateway payload numbers must be finite");
    }
    return ["number", value];
  }
  if (value instanceof Uint8Array) {
    return ["bytes", Buffer.from(value).toString("base64")];
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "Gateway payloads support only plain data and Uint8Array values",
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("Gateway payloads cannot contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return [
        "array",
        value.map((entry) => {
          if (entry === undefined) {
            throw new TypeError(
              "Gateway payload arrays cannot contain undefined",
            );
          }
          return encodeNode(entry, ancestors);
        }),
      ];
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Gateway payload objects must be plain objects");
    }
    return [
      "object",
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, entry]) =>
            [key, encodeNode(entry, ancestors)] as const,
        ),
    ];
  } finally {
    ancestors.delete(value);
  }
}

function decodeNode(value: EncodedValue): unknown {
  switch (value[0]) {
    case "null":
      return null;
    case "boolean":
    case "number":
    case "string":
      return value[1];
    case "bytes":
      return new Uint8Array(Buffer.from(value[1], "base64"));
    case "array":
      return value[1].map(decodeNode);
    case "object": {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of value[1]) {
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: decodeNode(entry),
          writable: true,
        });
      }
      return result;
    }
  }
}

function bytes(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must return Uint8Array`);
  }
  return new Uint8Array(value);
}

export function encodeGatewayValue(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(encodeNode(value, new Set())));
}

export function decodeGatewayValue(value: Uint8Array): unknown {
  const parsed = JSON.parse(decoder.decode(value)) as EncodedValue;
  return decodeNode(parsed);
}

export function digestGatewayValue(value: unknown): string {
  return createHash("sha256")
    .update(encodeGatewayValue(value))
    .digest("hex");
}

export function sealGatewayValue(
  cipher: GatewayCipher,
  purpose: string,
  value: unknown,
): Uint8Array {
  return bytes(
    cipher.seal(encodeGatewayValue(value), purpose),
    "GatewayCipher.seal()",
  );
}

export function openGatewayValue(
  cipher: GatewayCipher,
  purpose: string,
  value: Uint8Array,
): unknown {
  return decodeGatewayValue(
    bytes(cipher.open(value, purpose), "GatewayCipher.open()"),
  );
}
