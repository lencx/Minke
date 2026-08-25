#!/usr/bin/env node

import { parse } from "acorn";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

function contains(node, predicate) {
  let found = false;
  visit(node, (candidate) => {
    if (!found && predicate(candidate)) found = true;
  });
  return found;
}

function propertyName(node) {
  if (node?.type !== "MemberExpression") return undefined;
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

function isFileRead(node) {
  if (node.type !== "CallExpression") return false;
  if (
    node.callee.type === "Identifier" &&
    (node.callee.name === "readFile" ||
      node.callee.name === "readFileSync")
  ) {
    return true;
  }
  const name = propertyName(node.callee);
  return name === "readFile" || name === "readFileSync";
}

function bindingNames(pattern) {
  if (pattern === null || pattern === undefined) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "RestElement") {
    return bindingNames(pattern.argument);
  }
  if (pattern.type === "AssignmentPattern") {
    return bindingNames(pattern.left);
  }
  if (pattern.type === "ArrayPattern") {
    return pattern.elements.flatMap(bindingNames);
  }
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property) =>
      property.type === "RestElement"
        ? bindingNames(property.argument)
        : bindingNames(property.value)
    );
  }
  return [];
}

function sourceBindings(ast) {
  const candidates = [];
  visit(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.init !== null) {
      candidates.push({
        names: bindingNames(node.id),
        value: node.init,
      });
      return;
    }
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "="
    ) {
      candidates.push({
        names: bindingNames(node.left),
        value: node.right,
      });
      return;
    }
    if (
      node.type === "FunctionDeclaration" &&
      node.id !== null
    ) {
      candidates.push({
        names: [node.id.name],
        value: node.body,
      });
    }
  });

  const tainted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (
        !contains(candidate.value, isFileRead) &&
        !contains(
          candidate.value,
          (node) =>
            node.type === "Identifier" && tainted.has(node.name),
        )
      ) {
        continue;
      }
      for (const name of candidate.names) {
        if (tainted.has(name)) continue;
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
}

function isAssertMatch(node) {
  if (node.type !== "CallExpression") return false;
  if (node.callee.type !== "MemberExpression") return false;
  if (
    node.callee.object.type !== "Identifier" ||
    node.callee.object.name !== "assert"
  ) {
    return false;
  }
  const name = propertyName(node.callee);
  return name === "match" || name === "doesNotMatch";
}

export function auditSourceTextAssertions(
  source,
  filename = "<source>",
) {
  const ast = parse(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    locations: true,
    sourceType: "module",
  });
  const tainted = sourceBindings(ast);
  const findings = [];
  visit(ast, (node) => {
    if (!isAssertMatch(node)) return;
    const [actual] = node.arguments;
    if (
      actual === undefined ||
      (
        !contains(actual, isFileRead) &&
        !contains(
          actual,
          (candidate) =>
            candidate.type === "Identifier" &&
            tainted.has(candidate.name),
        )
      )
    ) {
      return;
    }
    findings.push({
      file: filename,
      line: node.loc?.start.line ?? 0,
      method: propertyName(node.callee),
    });
  });
  return findings;
}

async function collectTestFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(target));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(target);
    }
  }
  return files.sort();
}

export function portableRepositoryPath(path) {
  return path.replaceAll("\\", "/");
}

export async function auditRepositorySourceTextAssertions(
  root = projectRoot,
) {
  const counts = {};
  const findings = [];
  for (const file of await collectTestFiles(join(root, "tests"))) {
    const name = portableRepositoryPath(relative(root, file));
    const fileFindings = auditSourceTextAssertions(
      await readFile(file, "utf8"),
      name,
    );
    if (fileFindings.length === 0) continue;
    counts[name] = fileFindings.length;
    findings.push(...fileFindings);
  }
  return {
    counts: Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    ),
    findings,
  };
}

export function compareSourceAssertionBaseline(actual, expected) {
  const messages = [];
  const files = new Set([
    ...Object.keys(actual),
    ...Object.keys(expected),
  ]);
  for (const file of [...files].sort()) {
    const actualCount = actual[file] ?? 0;
    const expectedCount = expected[file] ?? 0;
    if (actualCount === expectedCount) continue;
    messages.push(
      `${file}: expected ${String(expectedCount)}, found ${String(actualCount)}`,
    );
  }
  return messages;
}

async function main() {
  const result = await auditRepositorySourceTextAssertions();
  process.stdout.write(`${JSON.stringify(result.counts, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
