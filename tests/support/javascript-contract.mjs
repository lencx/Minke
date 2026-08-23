import { parse } from "acorn";

function visit(node, callback) {
  if (node === null || typeof node !== "object") return;
  if (typeof node.type === "string") callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "end" ||
      key === "loc" ||
      key === "range" ||
      key === "start"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, callback);
      continue;
    }
    visit(value, callback);
  }
}

function memberProperty(node) {
  if (node.type !== "MemberExpression") return undefined;
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return undefined;
}

function expressionPath(node) {
  if (node.type === "ChainExpression") {
    return expressionPath(node.expression);
  }
  if (node.type === "Identifier") return node.name;
  if (node.type === "SequenceExpression") {
    return expressionPath(node.expressions.at(-1));
  }
  if (node.type !== "MemberExpression") return undefined;
  const object = expressionPath(node.object);
  const property = memberProperty(node);
  if (object === undefined || property === undefined) return undefined;
  return `${object}.${property}`;
}

function increment(values, key) {
  values.set(key, (values.get(key) ?? 0) + 1);
}

export function inspectJavaScriptContract(source) {
  const ast = parse(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    sourceType: "script",
  });
  const calls = new Map();
  const callArguments = new Map();
  const identifiers = new Set();
  const strings = new Map();
  visit(ast, (node) => {
    if (node.type === "Identifier") {
      identifiers.add(node.name);
      return;
    }
    if (
      node.type === "Literal" &&
      typeof node.value === "string"
    ) {
      increment(strings, node.value);
      return;
    }
    if (node.type === "CallExpression") {
      const path = expressionPath(node.callee);
      if (path === undefined) return;
      increment(calls, path);
      node.arguments.forEach((argument, index) => {
        if (
          argument.type !== "SpreadElement" &&
          argument.type === "Literal" &&
          typeof argument.value === "string"
        ) {
          increment(
            callArguments,
            `${path}\0${String(index)}\0${argument.value}`,
          );
        }
      });
    }
  });
  return Object.freeze({
    callWithStringArgumentCount: (path, index, value) =>
      callArguments.get(
        `${path}\0${String(index)}\0${value}`,
      ) ?? 0,
    callCount: (path) => calls.get(path) ?? 0,
    hasIdentifier: (name) => identifiers.has(name),
    stringCount: (value) => strings.get(value) ?? 0,
  });
}
