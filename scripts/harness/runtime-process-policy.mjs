import { parse } from "acorn";
import { readdir, readFile } from "node:fs/promises";
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
    let createProcessAsUserCount = 0;
    const startupInfoCalls = [];

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

      if (
        path.includes(
          `${sep}@deepseek-ai${sep}dsh-sandbox-windows-acl${sep}`,
        ) &&
        node.callee.type === "MemberExpression" &&
        staticPropertyName(node.callee) === "createProcessAsUserW"
      ) {
        createProcessAsUserCount += 1;
      }
      if (
        path.includes(
          `${sep}@deepseek-ai${sep}dsh-sandbox-windows-acl${sep}`,
        ) &&
        node.callee.type === "Identifier" &&
        node.callee.name === "encodeStartupInfo"
      ) {
        startupInfoCalls.push(node);
      }
    });

    if (createProcessAsUserCount === 0 && startupInfoCalls.length === 0) {
      continue;
    }
    if (createProcessAsUserCount !== startupInfoCalls.length) {
      violations.push(
        `${runtimePath(runtimeRoot, path)} has ${String(
          createProcessAsUserCount,
        )} CreateProcessAsUserW call(s) but ${String(
          startupInfoCalls.length,
        )} STARTUPINFOW configuration(s)`,
      );
    }
    for (const call of startupInfoCalls) {
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
