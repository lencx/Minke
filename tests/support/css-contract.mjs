function normalizeWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function parseDeclarations(source) {
  const declarations = new Map();
  for (const candidate of source.split(";")) {
    const separator = candidate.indexOf(":");
    if (separator < 1) continue;
    const property = candidate.slice(0, separator).trim();
    const value = normalizeWhitespace(
      candidate.slice(separator + 1),
    );
    if (property.length === 0 || value.length === 0) continue;
    declarations.set(property, value);
  }
  return declarations;
}

function skipComment(source, index) {
  const end = source.indexOf("*/", index + 2);
  return end < 0 ? source.length : end + 2;
}

function findBlockEnd(source, openIndex) {
  let depth = 1;
  let quote;
  for (
    let index = openIndex + 1;
    index < source.length;
    index += 1
  ) {
    const current = source[index];
    if (quote !== undefined) {
      if (current === "\\") {
        index += 1;
      } else if (current === quote) {
        quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "/" && source[index + 1] === "*") {
      index = skipComment(source, index) - 1;
      continue;
    }
    if (current === "{") depth += 1;
    if (current !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("CSS contract contains an unclosed block");
}

function rootBlocks(source) {
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length) {
      if (/\s/u.test(source[cursor])) {
        cursor += 1;
        continue;
      }
      if (
        source[cursor] === "/" &&
        source[cursor + 1] === "*"
      ) {
        cursor = skipComment(source, cursor);
        continue;
      }
      break;
    }
    if (cursor >= source.length) break;

    const preludeStart = cursor;
    let quote;
    let foundBlock = false;
    for (; cursor < source.length; cursor += 1) {
      const current = source[cursor];
      if (quote !== undefined) {
        if (current === "\\") {
          cursor += 1;
        } else if (current === quote) {
          quote = undefined;
        }
        continue;
      }
      if (current === "'" || current === '"') {
        quote = current;
        continue;
      }
      if (
        current === "/" &&
        source[cursor + 1] === "*"
      ) {
        cursor = skipComment(source, cursor) - 1;
        continue;
      }
      if (current === ";") {
        cursor += 1;
        break;
      }
      if (current !== "{") continue;
      const close = findBlockEnd(source, cursor);
      blocks.push({
        body: source.slice(cursor + 1, close),
        prelude: source.slice(preludeStart, cursor).trim(),
      });
      cursor = close + 1;
      foundBlock = true;
      break;
    }
    if (!foundBlock && cursor >= source.length) break;
  }
  return blocks;
}

function splitSelectorList(prelude) {
  const selectors = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let quote;
  for (let index = 0; index < prelude.length; index += 1) {
    const current = prelude[index];
    if (quote !== undefined) {
      if (current === "\\") {
        index += 1;
      } else if (current === quote) {
        quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "(") roundDepth += 1;
    else if (current === ")") roundDepth -= 1;
    else if (current === "[") squareDepth += 1;
    else if (current === "]") squareDepth -= 1;
    else if (
      current === "," &&
      roundDepth === 0 &&
      squareDepth === 0
    ) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors;
}

export function inspectCssContract(source) {
  const declarationsBySelector = new Map();
  for (const block of rootBlocks(source)) {
    const prelude = block.prelude;
    if (prelude.startsWith("@")) continue;
    const declarations = parseDeclarations(block.body);
    for (const selector of splitSelectorList(prelude)) {
      const normalized = normalizeWhitespace(selector);
      if (normalized.length === 0) continue;
      const rules =
        declarationsBySelector.get(normalized) ?? [];
      rules.push(declarations);
      declarationsBySelector.set(normalized, rules);
    }
  }

  const keyframes = new Set(
    [...source.matchAll(
      /@(?:-\w+-)?keyframes\s+([-\w]+)\s*\{/gu,
    )].map((match) => match[1]),
  );

  return Object.freeze({
    declaration(selector, property) {
      const rules = declarationsBySelector.get(
        normalizeWhitespace(selector),
      );
      if (rules === undefined) return undefined;
      for (let index = rules.length - 1; index >= 0; index -= 1) {
        const value = rules[index].get(property);
        if (value !== undefined) return value;
      }
      return undefined;
    },
    hasKeyframes(name) {
      return keyframes.has(name);
    },
    hasSelector(selector) {
      return declarationsBySelector.has(
        normalizeWhitespace(selector),
      );
    },
    selectors() {
      return Object.freeze([...declarationsBySelector.keys()]);
    },
  });
}
