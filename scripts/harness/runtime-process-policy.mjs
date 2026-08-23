import { parse } from "acorn";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const childProcessModules = new Set(["node:child_process", "child_process"]);
const childProcessMethods = new Set([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
]);
const startfUseShowWindow = 0x00000001;
const startfUseStdHandles = 0x00000100;
const swHide = 0;
const windowsAclPackage = "dsh-sandbox-windows-acl";

function staticPropertyName(property) {
  if (property.computed) {
    return property.property.type === "Literal" &&
      typeof property.property.value === "string"
      ? property.property.value
      : undefined;
  }
  if (property.property.type === "Identifier") {
    return property.property.name;
  }
  return property.property.type === "Literal" &&
    typeof property.property.value === "string"
    ? property.property.value
    : undefined;
}

function objectProperty(object, name) {
  if (object?.type !== "ObjectExpression") return undefined;
  return object.properties.find((property) => {
    if (property.type !== "Property") return false;
    const key =
      property.key.type === "Identifier" && !property.computed
        ? property.key.name
        : property.key.type === "Literal"
          ? property.key.value
          : undefined;
    return key === name;
  });
}

function literalPropertyValue(object, name) {
  const property = objectProperty(object, name);
  return property?.value.type === "Literal"
    ? property.value.value
    : undefined;
}

function namedObjectProperties(object, name) {
  if (object?.type !== "ObjectExpression") return [];
  return object.properties.filter((property) => {
    if (property.type !== "Property") return false;
    const key =
      property.key.type === "Identifier" && !property.computed
        ? property.key.name
        : property.key.type === "Literal"
          ? property.key.value
          : undefined;
    return key === name;
  });
}

function walk(node, visit, parent = undefined) {
  if (node === null || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else {
      walk(value, visit, node);
    }
  }
}

function requireSource(node) {
  if (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === "Literal" &&
    childProcessModules.has(node.arguments[0].value)
  ) {
    return node.arguments[0].value;
  }
  if (
    node?.type === "ImportExpression" &&
    node.source.type === "Literal" &&
    childProcessModules.has(node.source.value)
  ) {
    return node.source.value;
  }
  return undefined;
}

function collectChildProcessBindings(ast) {
  const direct = new Map();
  const namespaces = new Set();

  for (const statement of ast.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      !childProcessModules.has(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier") {
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        if (childProcessMethods.has(imported)) {
          direct.set(specifier.local.name, imported);
        }
      } else {
        namespaces.add(specifier.local.name);
      }
    }
  }

  walk(ast, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      requireSource(node.init) === undefined
    ) {
      return;
    }
    if (node.id.type === "Identifier") {
      namespaces.add(node.id.name);
      return;
    }
    if (node.id.type !== "ObjectPattern") return;
    for (const property of node.id.properties) {
      if (
        property.type !== "Property" ||
        property.key.type !== "Identifier" ||
        property.value.type !== "Identifier" ||
        !childProcessMethods.has(property.key.name)
      ) {
        continue;
      }
      direct.set(property.value.name, property.key.name);
    }
  });

  return { direct, namespaces };
}

function childProcessMethod(call, bindings) {
  if (
    call.callee.type === "Identifier" &&
    bindings.direct.has(call.callee.name)
  ) {
    return bindings.direct.get(call.callee.name);
  }
  if (
    call.callee.type === "MemberExpression" &&
    call.callee.object.type === "Identifier" &&
    bindings.namespaces.has(call.callee.object.name)
  ) {
    const method = staticPropertyName(call.callee);
    return childProcessMethods.has(method) ? method : undefined;
  }
  return undefined;
}

function hasExplicitHiddenWindow(call) {
  return call.arguments.slice(1).some((argument) => {
    const property = objectProperty(argument, "windowsHide");
    return property?.value.type === "Literal" && property.value.value === true;
  });
}

function runtimePath(runtimeRoot, path) {
  return relative(runtimeRoot, path).split(sep).join("/");
}

async function javascriptFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (
        entry.isFile() &&
        /\.(?:cjs|js|mjs)$/u.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }
  await visit(root);
  return files.sort();
}

function parseRuntimeJavaScript(source, path) {
  try {
    return parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      locations: true,
      sourceType: path.endsWith(".cjs") ? "script" : "module",
    });
  } catch (error) {
    throw new Error(
      `cannot audit staged Harness JavaScript ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isWindowsAclPath(path) {
  return path.includes(
    `${sep}@deepseek-ai${sep}${windowsAclPackage}${sep}`,
  );
}

function collectRestrictedLaunches(ast) {
  let createProcessAsUserCount = 0;
  const startupInfoCalls = [];
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    if (
      node.callee.type === "MemberExpression" &&
      staticPropertyName(node.callee) === "createProcessAsUserW"
    ) {
      createProcessAsUserCount += 1;
    }
    if (
      node.callee.type === "Identifier" &&
      node.callee.name === "encodeStartupInfo"
    ) {
      startupInfoCalls.push(node);
    }
  });
  return { createProcessAsUserCount, startupInfoCalls };
}

function assertRestrictedLaunchShape(path, restricted) {
  if (
    restricted.createProcessAsUserCount !==
    restricted.startupInfoCalls.length
  ) {
    throw new Error(
      `${path} has ${String(
        restricted.createProcessAsUserCount,
      )} CreateProcessAsUserW call(s) but ${String(
        restricted.startupInfoCalls.length,
      )} STARTUPINFOW configuration(s)`,
    );
  }
}

function propertyLayoutAfter(source, property, nextProperty) {
  if (nextProperty === undefined) return ", wShowWindow: 0";
  const separator = source.slice(property.end, nextProperty.start);
  if (!separator.includes(",")) {
    throw new Error("dwFlags is not followed by an object-property separator");
  }
  const lastNewline = separator.lastIndexOf("\n");
  const layout = lastNewline === -1
    ? " "
    : `${separator.includes("\r\n") ? "\r\n" : "\n"}${separator.slice(
        lastNewline + 1,
      ).replace(/[^ \t]/gu, "")}`;
  return `wShowWindow: 0,${layout}`;
}

function planRestrictedLaunchEdits(source, path, call) {
  const startup = call.arguments[1];
  if (startup?.type !== "ObjectExpression") {
    throw new Error(
      `${path}:${String(
        call.loc.start.line,
      )} encodeStartupInfo() must use a static STARTUPINFOW object`,
    );
  }
  const flagProperties = namedObjectProperties(startup, "dwFlags");
  const showProperties = namedObjectProperties(startup, "wShowWindow");
  if (flagProperties.length !== 1 || showProperties.length > 1) {
    throw new Error(
      `${path}:${String(
        call.loc.start.line,
      )} STARTUPINFOW must declare one dwFlags and at most one wShowWindow`,
    );
  }
  const flagsProperty = flagProperties[0];
  const flags =
    flagsProperty.value.type === "Literal" &&
    typeof flagsProperty.value.value === "number"
      ? flagsProperty.value.value
      : undefined;
  if (
    flags === undefined ||
    (flags & startfUseStdHandles) === 0
  ) {
    throw new Error(
      `${path}:${String(
        call.loc.start.line,
      )} STARTUPINFOW dwFlags must statically include STARTF_USESTDHANDLES`,
    );
  }

  const edits = [];
  const hiddenFlags = flags | startfUseShowWindow;
  if (hiddenFlags !== flags) {
    edits.push({
      end: flagsProperty.value.end,
      start: flagsProperty.value.start,
      text: String(hiddenFlags),
    });
  }

  const showProperty = showProperties[0];
  if (showProperty === undefined) {
    const propertyIndex = startup.properties.indexOf(flagsProperty);
    const nextProperty = startup.properties[propertyIndex + 1];
    edits.push({
      end: nextProperty?.start ?? flagsProperty.end,
      start: nextProperty?.start ?? flagsProperty.end,
      text: propertyLayoutAfter(source, flagsProperty, nextProperty),
    });
  } else if (
    showProperty.value.type === "Literal" &&
    typeof showProperty.value.value === "number"
  ) {
    if (showProperty.value.value !== swHide) {
      edits.push({
        end: showProperty.value.end,
        start: showProperty.value.start,
        text: String(swHide),
      });
    }
  } else {
    throw new Error(
      `${path}:${String(
        call.loc.start.line,
      )} STARTUPINFOW wShowWindow must be a static numeric value`,
    );
  }
  return edits;
}

function applySourceEdits(source, edits) {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

/**
 * Harden every restricted-token process launch in the deployed Windows ACL
 * package. The package emits platform-dependent bundle hashes, so this
 * transform intentionally discovers actual JavaScript artifacts instead of
 * pinning generated filenames in a static patch.
 */
export async function hardenHarnessWindowsRestrictedLaunches(runtimeRoot) {
  const aclRoot = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    windowsAclPackage,
  );
  const plannedFiles = [];
  let launches = 0;
  let changedLaunches = 0;

  for (const path of await javascriptFiles(aclRoot)) {
    const source = await readFile(path, "utf8");
    const relativePath = runtimePath(runtimeRoot, path);
    const ast = parseRuntimeJavaScript(source, relativePath);
    const restricted = collectRestrictedLaunches(ast);
    if (
      restricted.createProcessAsUserCount === 0 &&
      restricted.startupInfoCalls.length === 0
    ) {
      continue;
    }
    assertRestrictedLaunchShape(relativePath, restricted);
    const launchEdits = restricted.startupInfoCalls.map((call) =>
      planRestrictedLaunchEdits(source, relativePath, call),
    );
    const edits = launchEdits.flat();
    launches += restricted.createProcessAsUserCount;
    changedLaunches += launchEdits.filter((launch) => launch.length > 0).length;
    plannedFiles.push({
      path,
      source: applySourceEdits(source, edits),
    });
  }

  if (launches === 0) {
    throw new Error(
      "staged Harness Windows ACL runtime has no CreateProcessAsUserW launch sites",
    );
  }
  await Promise.all(
    plannedFiles.map(({ path, source }) => writeFile(path, source)),
  );
  return {
    changedLaunches,
    files: plannedFiles.length,
    launches,
  };
}

/**
 * Inspect first-party process launch sites in a staged Harness runtime.
 * Non-terminal child_process calls must always suppress native Windows
 * console windows. PTY/ConPTY launches use node-pty and therefore remain
 * outside this background-process contract.
 */
export async function inspectHarnessRuntimeProcessPolicy(runtimeRoot) {
  const firstPartyRoot = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
  );
  const launches = [];
  const restrictedLaunches = [];
  const violations = [];

  for (const path of await javascriptFiles(firstPartyRoot)) {
    const source = await readFile(path, "utf8");
    const ast = parseRuntimeJavaScript(source, runtimePath(runtimeRoot, path));
    const bindings = collectChildProcessBindings(ast);
    const restricted = isWindowsAclPath(path)
      ? collectRestrictedLaunches(ast)
      : { createProcessAsUserCount: 0, startupInfoCalls: [] };

    walk(ast, (node) => {
      if (node.type !== "CallExpression") return;
      const method = childProcessMethod(node, bindings);
      if (method !== undefined) {
        const launch = {
          method,
          path: runtimePath(runtimeRoot, path),
          line: node.loc.start.line,
        };
        launches.push(launch);
        if (!hasExplicitHiddenWindow(node)) {
          violations.push(
            `${launch.path}:${String(launch.line)} ${method}() must set windowsHide: true`,
          );
        }
      }
    });

    if (
      restricted.createProcessAsUserCount === 0 &&
      restricted.startupInfoCalls.length === 0
    ) {
      continue;
    }
    if (
      restricted.createProcessAsUserCount !==
      restricted.startupInfoCalls.length
    ) {
      violations.push(
        `${runtimePath(runtimeRoot, path)} has ${String(
          restricted.createProcessAsUserCount,
        )} CreateProcessAsUserW call(s) but ${String(
          restricted.startupInfoCalls.length,
        )} STARTUPINFOW configuration(s)`,
      );
    }
    for (const call of restricted.startupInfoCalls) {
      const startup = call.arguments[1];
      const flags = literalPropertyValue(startup, "dwFlags");
      const showWindow = literalPropertyValue(startup, "wShowWindow");
      const launch = {
        path: runtimePath(runtimeRoot, path),
        line: call.loc.start.line,
      };
      restrictedLaunches.push(launch);
      if (
        typeof flags !== "number" ||
        (flags & startfUseShowWindow) === 0 ||
        (flags & startfUseStdHandles) === 0 ||
        showWindow !== swHide
      ) {
        violations.push(
          `${launch.path}:${String(
            launch.line,
          )} restricted Windows launch must combine STARTF_USESHOWWINDOW and STARTF_USESTDHANDLES with SW_HIDE`,
        );
      }
    }
  }

  return { launches, restrictedLaunches, violations };
}

export async function verifyHarnessRuntimeProcessPolicy(runtimeRoot) {
  const inspection = await inspectHarnessRuntimeProcessPolicy(runtimeRoot);
  if (inspection.launches.length === 0) {
    throw new Error(
      "staged Harness runtime process audit found no first-party child_process launch sites",
    );
  }
  if (inspection.violations.length > 0) {
    throw new Error(
      `staged Harness runtime process policy failed:\n${inspection.violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
  }
  return inspection;
}
