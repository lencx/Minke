import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "acorn";

/**
 * Inspect one shipped browser artifact for Host-only or secure-context-only
 * crypto calls.
 */
export function inspectHarnessClientArtifact(source, path) {
  const program = parse(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    locations: true,
    sourceType: "module",
  });
  const violations = [];
  visit(program, (node) => {
    if (
      node.type === "MemberExpression" &&
      propertyName(node) === "randomUUID" &&
      isBrowserCrypto(node.object)
    ) {
      violations.push({
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        reason:
          "references secure-context-only crypto.randomUUID; use the browser-compatible @deepseek-ai/dsh-util-crypto interface",
      });
    }

    const specifier = importedModuleSpecifier(node);
    if (specifier === "node:crypto" || specifier === "crypto") {
      violations.push({
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        reason: `imports Host-only ${specifier}`,
      });
    }
  });
  if (violations.length > 0) {
    throw new Error(
      [
        "Harness browser crypto boundary violation:",
        ...violations.map(
          (violation) =>
            `  ${path}:${String(violation.line)}:${String(
              violation.column,
            )} ${violation.reason}`,
        ),
      ].join("\n"),
    );
  }
  return { path, violations: [] };
}

/**
 * Inspect every installed Harness Client bundle plus the static web frontend.
 */
export async function inspectHarnessClientCryptoBoundary(
  runtimeRoot,
  frontendPackageName,
) {
  const artifacts = await browserArtifactPaths(
    runtimeRoot,
    frontendPackageName,
  );
  if (artifacts.length === 0) {
    throw new Error(
      "staged Harness runtime contains no browser JavaScript artifacts",
    );
  }
  for (const path of artifacts) {
    inspectHarnessClientArtifact(
      await readFile(path, "utf8"),
      relative(runtimeRoot, path),
    );
  }
  return Object.freeze({ artifacts: artifacts.length });
}

async function browserArtifactPaths(runtimeRoot, frontendPackageName) {
  const nodeModulesRoot = join(runtimeRoot, "node_modules");
  const packageRoots = [];
  for (const entry of await readdir(nodeModulesRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("@")) {
      packageRoots.push(join(nodeModulesRoot, entry.name));
      continue;
    }
    const scopeRoot = join(nodeModulesRoot, entry.name);
    for (const scoped of await readdir(scopeRoot, {
      withFileTypes: true,
    })) {
      if (scoped.isDirectory()) {
        packageRoots.push(join(scopeRoot, scoped.name));
      }
    }
  }

  const artifacts = [];
  for (const packageRoot of packageRoots) {
    const clientBundle = join(packageRoot, "lib", "client.js");
    try {
      await readFile(clientBundle, "utf8");
      artifacts.push(clientBundle);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const frontendRoot = join(
    nodeModulesRoot,
    ...frontendPackageName.split("/"),
    "dist",
  );
  await collectJavaScript(frontendRoot, artifacts);
  return artifacts.sort();
}

async function collectJavaScript(root, artifacts) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScript(path, artifacts);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      artifacts.push(path);
    }
  }
}

function visit(value, inspect) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, inspect);
    return;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.type !== "string"
  ) {
    return;
  }
  inspect(value);
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "end" ||
      key === "loc" ||
      key === "range" ||
      key === "start" ||
      key === "type"
    ) {
      continue;
    }
    visit(child, inspect);
  }
}

function propertyName(member) {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
  ) {
    return member.property.value;
  }
  return undefined;
}

function isBrowserCrypto(value) {
  if (value.type === "Identifier") return value.name === "crypto";
  return (
    value.type === "MemberExpression" &&
    propertyName(value) === "crypto" &&
    value.object.type === "Identifier" &&
    (value.object.name === "globalThis" ||
      value.object.name === "self" ||
      value.object.name === "window")
  );
}

function importedModuleSpecifier(node) {
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportAllDeclaration" ||
    node.type === "ExportNamedDeclaration"
  ) {
    return literalString(node.source);
  }
  if (node.type === "ImportExpression") {
    return literalString(node.source);
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  ) {
    return literalString(node.arguments[0]);
  }
  return undefined;
}

function literalString(value) {
  return value?.type === "Literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}
