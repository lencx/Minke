import { parse } from "acorn";
import {
  MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH,
} from "@minke/harness-overlay/agent-browser-contract.ts";

export const MAX_GENERATED_LOCATOR_STEPS = 12;

export interface GeneratedLocatorTextMatcher {
  readonly kind: "text" | "regex";
  readonly value: string;
  readonly flags?: string;
}

export type GeneratedLocatorStep =
  | {
      readonly kind: "locator";
      readonly selector: string;
    }
  | {
      readonly kind: "getByRole";
      readonly role: string;
      readonly name?: GeneratedLocatorTextMatcher;
      readonly exact: boolean;
    }
  | {
      readonly kind: "getByText";
      readonly text: GeneratedLocatorTextMatcher;
      readonly exact: boolean;
    }
  | {
      readonly kind: "filter";
      readonly hasText: GeneratedLocatorTextMatcher;
    }
  | {
      readonly kind: "nth";
      readonly index: number;
    }
  | {
      readonly kind: "first" | "last";
    }
  | {
      readonly kind:
        | "parent"
        | "next"
        | "previous"
        | "children";
      readonly selector?: string;
    }
  | {
      readonly kind: "closest";
      readonly selector: string;
    };

type AstRecord = Record<string, unknown> & {
  readonly type: string;
};

function astRecord(value: unknown, label: string): AstRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).type !== "string"
  ) {
    throw new TypeError(`${label} must be a JavaScript syntax node`);
  }
  return value as AstRecord;
}

function argumentsOf(call: AstRecord): readonly unknown[] {
  if (!Array.isArray(call.arguments)) {
    throw new TypeError("generated locator call has invalid arguments");
  }
  return call.arguments;
}

function stringLiteral(
  value: unknown,
  label: string,
  maximumLength = 1_000,
): string {
  const literal = astRecord(value, label);
  if (
    literal.type !== "Literal" ||
    typeof literal.value !== "string" ||
    literal.value.length === 0 ||
    literal.value.length > maximumLength
  ) {
    throw new TypeError(`${label} must be a non-empty string literal`);
  }
  return literal.value;
}

function booleanLiteral(value: unknown, label: string): boolean {
  const literal = astRecord(value, label);
  if (
    literal.type !== "Literal" ||
    typeof literal.value !== "boolean"
  ) {
    throw new TypeError(`${label} must be a boolean literal`);
  }
  return literal.value;
}

function integerLiteral(value: unknown, label: string): number {
  const literal = astRecord(value, label);
  if (
    literal.type !== "Literal" ||
    !Number.isSafeInteger(literal.value) ||
    Number(literal.value) < 0 ||
    Number(literal.value) > 49_999
  ) {
    throw new TypeError(
      `${label} must be a non-negative integer literal`,
    );
  }
  return Number(literal.value);
}

function propertyName(property: AstRecord): string {
  if (
    property.type !== "Property" ||
    property.computed === true ||
    property.kind !== "init" ||
    property.method === true ||
    property.shorthand === true
  ) {
    throw new TypeError(
      "generated locator options require plain named properties",
    );
  }
  const key = astRecord(property.key, "generated locator option");
  if (key.type === "Identifier" && typeof key.name === "string") {
    return key.name;
  }
  if (key.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }
  throw new TypeError(
    "generated locator option names must be identifiers or strings",
  );
}

function objectProperties(
  value: unknown,
  label: string,
): Map<string, unknown> {
  const object = astRecord(value, label);
  if (
    object.type !== "ObjectExpression" ||
    !Array.isArray(object.properties)
  ) {
    throw new TypeError(`${label} must be an object literal`);
  }
  const properties = new Map<string, unknown>();
  for (const rawProperty of object.properties) {
    const property = astRecord(
      rawProperty,
      "generated locator option",
    );
    const name = propertyName(property);
    if (properties.has(name)) {
      throw new TypeError(
        `generated locator option ${name} is duplicated`,
      );
    }
    properties.set(name, property.value);
  }
  return properties;
}

function exactOption(
  properties: Map<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  for (const name of properties.keys()) {
    if (!allowed.has(name)) {
      throw new TypeError(
        `unsupported generated locator option ${name}`,
      );
    }
  }
  const rawExact = properties.get("exact");
  return rawExact === undefined
    ? false
    : booleanLiteral(rawExact, "generated locator exact option");
}

/**
 * Generated patterns deliberately support only a small, linear-time subset.
 *
 * Groups, repetition, lookarounds, backreferences, and multiple optional
 * atoms are unnecessary for locator names and can make JavaScript regular
 * expressions consume super-linear or exponential time on page-owned text.
 */
function safeRegexLiteral(pattern: string, flags: string): boolean {
  if (!/^[imu]*$/u.test(flags)) return false;
  let escaped = false;
  let inCharacterClass = false;
  let optionalAtoms = 0;
  for (const character of pattern) {
    if (escaped) {
      if (
        /^[1-9]$/u.test(character) ||
        character === "k"
      ) {
        return false;
      }
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (
      character === "(" ||
      character === ")" ||
      character === "*" ||
      character === "+" ||
      character === "{" ||
      character === "}"
    ) {
      return false;
    }
    if (character === "?") {
      optionalAtoms += 1;
      if (optionalAtoms > 1) return false;
    }
  }
  return !escaped && !inCharacterClass;
}

function textMatcher(
  value: unknown,
  label: string,
): GeneratedLocatorTextMatcher {
  const literal = astRecord(value, label);
  if (literal.type !== "Literal") {
    throw new TypeError(
      `${label} must be a string or regular-expression literal`,
    );
  }
  if (typeof literal.value === "string") {
    if (literal.value.length === 0 || literal.value.length > 500) {
      throw new TypeError(
        `${label} must be a non-empty bounded text literal`,
      );
    }
    return { kind: "text", value: literal.value };
  }
  const regex =
    typeof literal.regex === "object" &&
      literal.regex !== null &&
      !Array.isArray(literal.regex)
      ? literal.regex as Record<string, unknown>
      : undefined;
  if (
    regex === undefined ||
    typeof regex.pattern !== "string" ||
    typeof regex.flags !== "string" ||
    regex.pattern.length === 0 ||
    regex.pattern.length > 500 ||
    !safeRegexLiteral(regex.pattern, regex.flags)
  ) {
    throw new TypeError(
      `${label} must be a bounded safe regular-expression literal`,
    );
  }
  return {
    kind: "regex",
    value: regex.pattern,
    ...(regex.flags === "" ? {} : { flags: regex.flags }),
  };
}

function optionalSelector(
  args: readonly unknown[],
  method: string,
): string | undefined {
  if (args.length > 1) {
    throw new TypeError(
      `page.${method} accepts at most one selector literal`,
    );
  }
  return args.length === 0
    ? undefined
    : stringLiteral(
        args[0],
        `page.${method} selector`,
      );
}

function parseMethod(
  method: string,
  args: readonly unknown[],
): GeneratedLocatorStep {
  switch (method) {
    case "locator":
      if (args.length !== 1) {
        throw new TypeError(
          "page.locator requires one CSS selector literal",
        );
      }
      return {
        kind: "locator",
        selector: stringLiteral(
          args[0],
          "page.locator selector",
        ),
      };
    case "getByRole": {
      if (args.length < 1 || args.length > 2) {
        throw new TypeError(
          "page.getByRole requires a role and optional options",
        );
      }
      const properties = args[1] === undefined
        ? new Map<string, unknown>()
        : objectProperties(
            args[1],
            "page.getByRole options",
          );
      const exact = exactOption(
        properties,
        new Set(["name", "exact"]),
      );
      const rawName = properties.get("name");
      return {
        kind: "getByRole",
        role: stringLiteral(
          args[0],
          "page.getByRole role",
          80,
        ),
        ...(rawName === undefined
          ? {}
          : {
              name: textMatcher(
                rawName,
                "page.getByRole name",
              ),
            }),
        exact,
      };
    }
    case "getByText": {
      if (args.length < 1 || args.length > 2) {
        throw new TypeError(
          "page.getByText requires text and optional options",
        );
      }
      const properties = args[1] === undefined
        ? new Map<string, unknown>()
        : objectProperties(
            args[1],
            "page.getByText options",
          );
      return {
        kind: "getByText",
        text: textMatcher(
          args[0],
          "page.getByText text",
        ),
        exact: exactOption(
          properties,
          new Set(["exact"]),
        ),
      };
    }
    case "filter": {
      if (args.length !== 1) {
        throw new TypeError(
          "page.filter requires one options object",
        );
      }
      const properties = objectProperties(
        args[0],
        "page.filter options",
      );
      for (const name of properties.keys()) {
        if (name !== "hasText") {
          throw new TypeError(
            `unsupported generated locator option ${name}`,
          );
        }
      }
      const rawHasText = properties.get("hasText");
      if (rawHasText === undefined) {
        throw new TypeError(
          "page.filter requires a hasText option",
        );
      }
      return {
        kind: "filter",
        hasText: textMatcher(
          rawHasText,
          "page.filter hasText",
        ),
      };
    }
    case "nth":
      if (args.length !== 1) {
        throw new TypeError(
          "page.nth requires one zero-based index literal",
        );
      }
      return {
        kind: "nth",
        index: integerLiteral(
          args[0],
          "page.nth index",
        ),
      };
    case "first":
    case "last":
      if (args.length !== 0) {
        throw new TypeError(`page.${method} accepts no arguments`);
      }
      return { kind: method };
    case "parent":
    case "next":
    case "previous":
    case "children": {
      const selector = optionalSelector(args, method);
      return {
        kind: method,
        ...(selector === undefined ? {} : { selector }),
      };
    }
    case "closest":
      if (args.length !== 1) {
        throw new TypeError(
          "page.closest requires one CSS selector literal",
        );
      }
      return {
        kind: "closest",
        selector: stringLiteral(
          args[0],
          "page.closest selector",
        ),
      };
    default:
      throw new TypeError(
        `unsupported generated locator method ${method}`,
      );
  }
}

function parseChain(
  value: unknown,
): GeneratedLocatorStep[] {
  const expression = astRecord(
    value,
    "generated locator expression",
  );
  if (expression.type === "AwaitExpression") {
    return parseChain(expression.argument);
  }
  if (
    expression.type === "Identifier" &&
    expression.name === "page"
  ) {
    return [];
  }
  if (expression.type !== "CallExpression") {
    throw new TypeError(
      "generated locator code must be one page method chain",
    );
  }
  const callee = astRecord(
    expression.callee,
    "generated locator call",
  );
  if (
    callee.type !== "MemberExpression" ||
    callee.computed === true ||
    callee.optional === true
  ) {
    throw new TypeError(
      "generated locator calls require plain page methods",
    );
  }
  const property = astRecord(
    callee.property,
    "generated locator method",
  );
  if (
    property.type !== "Identifier" ||
    typeof property.name !== "string"
  ) {
    throw new TypeError(
      "generated locator method must be an identifier",
    );
  }
  const steps = parseChain(callee.object);
  steps.push(
    parseMethod(property.name, argumentsOf(expression)),
  );
  if (steps.length > MAX_GENERATED_LOCATOR_STEPS) {
    throw new TypeError(
      `generated locator exceeds ${String(MAX_GENERATED_LOCATOR_STEPS)} steps`,
    );
  }
  return steps;
}

/**
 * Parse model-generated JavaScript-shaped locator code into a closed plan.
 *
 * No generated code is evaluated. Only a single allowlisted `page.*` call
 * chain with literal arguments is accepted.
 */
export function parseGeneratedLocatorCode(
  value: unknown,
): readonly GeneratedLocatorStep[] {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH
  ) {
    throw new TypeError(
      "generated locator code must be a non-empty bounded string",
    );
  }
  let program: AstRecord;
  try {
    program = astRecord(
      parse(value, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowAwaitOutsideFunction: true,
      }),
      "generated locator program",
    );
  } catch (error) {
    throw new TypeError(
      `invalid generated locator JavaScript: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    program.type !== "Program" ||
    !Array.isArray(program.body) ||
    program.body.length !== 1
  ) {
    throw new TypeError(
      "generated locator code must contain one expression",
    );
  }
  const statement = astRecord(
    program.body[0],
    "generated locator statement",
  );
  if (statement.type !== "ExpressionStatement") {
    throw new TypeError(
      "generated locator code must contain one expression",
    );
  }
  const steps = parseChain(statement.expression);
  if (steps.length === 0) {
    throw new TypeError(
      "generated locator code must call at least one page method",
    );
  }
  let terminalSemanticIndex = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step?.kind === "getByRole" ||
      step?.kind === "getByText"
    ) {
      terminalSemanticIndex = index;
      break;
    }
  }
  const terminalSteps =
    terminalSemanticIndex < 0
      ? steps
      : steps.slice(terminalSemanticIndex + 1);
  if (
    terminalSemanticIndex < 0 ||
    terminalSteps.some((step) => step.kind !== "filter")
  ) {
    throw new TypeError(
      "generated locator must end with getByRole/getByText "
        + "terminal semantic action evidence, optionally followed by filter",
    );
  }
  return steps;
}

/**
 * Fixed page-side resolver for a parsed locator plan.
 *
 * This function is bundled as source and called in a main-frame isolated
 * world with validated JSON. The model-generated source never reaches
 * Runtime.evaluate/callFunctionOn. It returns one remote binding object so
 * count, diagnostics, and the exact matched element share one evaluation.
 */
export const GENERATED_LOCATOR_RESOLVER_FUNCTION =
  `function minkeResolveGeneratedLocator(plan) {
    const maximumCandidates = 50000;
    const maximumCandidateVisits = 200000;
    const maximumQueries = 10000;
    const maximumMatchTextLength = 20000;
    let truncated = false;
    let candidateVisits = 0;
    let queries = 0;
    let current = [this];
    const normalized = (value) => {
      const text = String(value ?? "");
      if (text.length > maximumMatchTextLength) {
        truncated = true;
        return "";
      }
      return text.replace(/\\s+/gu, " ").trim();
    };
    const selectorFailure = (selector, error) =>
      new Error(
        "Invalid generated locator selector " +
        JSON.stringify(selector) + ": " +
        String(error && error.message ? error.message : error)
      );
    const query = (root, selector) => {
      queries += 1;
      if (queries > maximumQueries) {
        truncated = true;
        return [];
      }
      try {
        return root.querySelectorAll(selector);
      } catch (error) {
        throw selectorFailure(selector, error);
      }
    };
    const matchesSelector = (element, selector) => {
      try {
        return element.matches(selector);
      } catch (error) {
        throw selectorFailure(selector, error);
      }
    };
    const closest = (element, selector) => {
      try {
        return element.closest(selector);
      } catch (error) {
        throw selectorFailure(selector, error);
      }
    };
    const addCandidate = (result, seen, value, accept) => {
      candidateVisits += 1;
      if (candidateVisits > maximumCandidateVisits) {
        truncated = true;
        return false;
      }
      if (
        value == null ||
        (value.nodeType !== 1 && value.nodeType !== 9) ||
        seen.has(value)
      ) {
        return true;
      }
      if (!accept(value) || truncated) return !truncated;
      if (result.length >= maximumCandidates) {
        truncated = true;
        return false;
      }
      seen.add(value);
      result.push(value);
      return true;
    };
    const collect = (iterables, accept) => {
      const result = [];
      const seen = new Set();
      for (const iterable of iterables) {
        if (truncated) break;
        for (const value of iterable) {
          if (!addCandidate(result, seen, value, accept)) break;
        }
      }
      return result;
    };
    const queryAll = (roots, selector, accept) => {
      const result = [];
      const seen = new Set();
      for (const root of roots) {
        if (truncated) break;
        const matches = query(root, selector);
        for (const value of matches) {
          if (!addCandidate(result, seen, value, accept)) break;
        }
      }
      return result;
    };
    const roleOf = (element) => {
      const explicit = normalized(element.getAttribute("role"));
      if (explicit !== "") return explicit.toLowerCase();
      const tag = String(element.localName || "").toLowerCase();
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "button") return "button";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "option") return "option";
      if (tag === "img") return "img";
      if (tag === "summary") return "button";
      if (tag === "input") {
        const type = normalized(element.getAttribute("type")).toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset", "image"].includes(type)) {
          return "button";
        }
        return "textbox";
      }
      return "";
    };
    const nameOf = (element) => {
      const labelledBy = normalized(element.getAttribute("aria-labelledby"));
      if (labelledBy !== "") {
        const parts = labelledBy.split(" ").map((id) => {
          const labelled = element.ownerDocument.getElementById(id);
          return labelled == null
            ? ""
            : normalized(labelled.innerText || labelled.textContent);
        }).filter(Boolean);
        if (parts.length > 0) return normalized(parts.join(" "));
      }
      for (const attribute of ["aria-label", "alt"]) {
        const candidate = normalized(element.getAttribute(attribute));
        if (candidate !== "") return candidate;
      }
      const tag = String(element.localName || "").toLowerCase();
      if (tag === "input") {
        const value = normalized(element.value);
        if (value !== "") return value;
      }
      return normalized(element.innerText || element.textContent);
    };
    const expressionCache = new Map();
    const matcherMatches = (actual, matcher, exact) => {
      const candidate = normalized(actual);
      if (truncated) return false;
      if (matcher.kind === "regex") {
        const expressionKey =
          matcher.value + "\\u0000" + (matcher.flags || "");
        let expression = expressionCache.get(expressionKey);
        if (expression == null) {
          expression = new RegExp(
            matcher.value,
            matcher.flags || ""
          );
          expressionCache.set(expressionKey, expression);
        }
        expression.lastIndex = 0;
        return expression.test(candidate);
      }
      const expected = normalized(matcher.value);
      return exact
        ? candidate.toLowerCase() === expected.toLowerCase()
        : candidate.toLowerCase().includes(expected.toLowerCase());
    };
    for (const step of plan) {
      if (step.kind === "locator") {
        current = queryAll(
          current,
          step.selector,
          () => true
        );
      } else if (step.kind === "getByRole") {
        current = queryAll(
          current,
          "*",
          (element) =>
            roleOf(element) === normalized(step.role).toLowerCase() &&
            (
              step.name == null ||
              matcherMatches(
                nameOf(element),
                step.name,
                step.exact === true
              )
            )
        );
      } else if (step.kind === "getByText") {
        current = queryAll(
          current,
          "*",
          (element) =>
            matcherMatches(
              element.innerText || element.textContent,
              step.text,
              step.exact === true
            )
        );
      } else if (step.kind === "filter") {
        current = collect(
          [current],
          (element) =>
            matcherMatches(
              element.innerText || element.textContent,
              step.hasText,
              false
            )
        );
      } else if (step.kind === "nth") {
        current = current[step.index] == null
          ? []
          : [current[step.index]];
      } else if (step.kind === "first") {
        current = current.length === 0 ? [] : [current[0]];
      } else if (step.kind === "last") {
        current = current.length === 0
          ? []
          : [current[current.length - 1]];
      } else if (step.kind === "parent") {
        current = collect(
          [current.map((element) => element.parentElement)],
          (element) =>
            step.selector == null ||
            matchesSelector(element, step.selector)
        );
      } else if (step.kind === "next") {
        current = collect(
          [current.map((element) => element.nextElementSibling)],
          (element) =>
            step.selector == null ||
            matchesSelector(element, step.selector)
        );
      } else if (step.kind === "previous") {
        current = collect(
          [current.map(
            (element) => element.previousElementSibling
          )],
          (element) =>
            step.selector == null ||
            matchesSelector(element, step.selector)
        );
      } else if (step.kind === "children") {
        current = collect(
          current.map((element) => element.children),
          (element) =>
            step.selector == null ||
            matchesSelector(element, step.selector)
        );
      } else if (step.kind === "closest") {
        current = collect(
          [current.map(
            (element) => closest(element, step.selector)
          )],
          () => true
        );
      } else {
        throw new Error("Unsupported generated locator plan step");
      }
      if (truncated) {
        current = [];
        break;
      }
    }
    const samples = current.slice(0, 5).map((element) => ({
      tag: String(element.localName || "").toLowerCase(),
      role: roleOf(element),
      name: nameOf(element).slice(0, 200),
      text: normalized(
        element.innerText || element.textContent
      ).slice(0, 200),
      href: typeof element.href === "string"
        ? element.href.slice(0, 2048)
        : "",
    }));
    return {
      count: current.length,
      truncated,
      samplesText: JSON.stringify(samples).slice(0, 1000),
      element:
        !truncated && current.length === 1 ? current[0] : null,
    };
  }`;
