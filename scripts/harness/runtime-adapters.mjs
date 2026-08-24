import { embeddedNodeEnvironment } from "../../config/embedded-node-runtime.mts";

const executableName = embeddedNodeEnvironment.executable;
const pnpmEntryName = embeddedNodeEnvironment.pnpmEntry;
const modeName = embeddedNodeEnvironment.mode;
const interactiveNodeOptionsName =
  embeddedNodeEnvironment.interactiveNodeOptions;
const interactiveNodePathName =
  embeddedNodeEnvironment.interactiveNodePath;
const environmentBootstrapName = "node-environment-bootstrap.cjs";

function shellReference(name) {
  return `$${name}`;
}

function shellRequirement(name) {
  return "${" + name + ":?" + name + " is required}";
}

function cmdReference(name) {
  return `%${name}%`;
}

/**
 * Generate the complete cross-platform adapter set staged with Harness.
 * Every adapter delegates to Minke's Electron binary and reasserts Node mode;
 * no ambient or standalone Node installation participates. The dsh adapter
 * exposes Node internals so Harness can resolve bare plugins from the active
 * profile instead of from its bundled loader package.
 */
export function runtimeAdapterSources() {
  return {
    [environmentBootstrapName]: `"use strict";
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const { promisify } = require("node:util");
const bootstrapPath = __filename;
const embeddedExecutable = process.env.MINKE_NODE_EXECUTABLE;
const controls = [
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH",
];
const childControls = [
  ...controls,
  "MINKE_INTERACTIVE_NODE_OPTIONS",
  "MINKE_INTERACTIVE_NODE_PATH",
  "MINKE_NODE_BOOTSTRAP",
];

function deleteEnvironmentName(environment, name) {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === name) delete environment[key];
  }
}

function childEnvironment(source, embeddedNode) {
  const environment = { ...(source ?? process.env) };
  for (const name of childControls) {
    deleteEnvironmentName(environment, name);
  }
  if (embeddedNode) {
    environment.ELECTRON_RUN_AS_NODE = "1";
    environment.MINKE_NODE_BOOTSTRAP = bootstrapPath;
  }
  return environment;
}

function sameExecutable(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return process.platform === "win32"
    ? left.toUpperCase() === right.toUpperCase()
    : left === right;
}

function isEmbeddedNodeExecutable(file) {
  return sameExecutable(file, process.execPath) ||
    sameExecutable(file, embeddedExecutable);
}

function usesShell(options) {
  return (
    typeof options === "object" &&
    options !== null &&
    options.shell !== undefined &&
    options.shell !== false
  );
}

function withBootstrap(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      ((argument === "--require" || argument === "-r") &&
        args[index + 1] === bootstrapPath) ||
      argument === \`--require=\${bootstrapPath}\`
    ) {
      return [...args];
    }
  }
  return ["--require", bootstrapPath, ...args];
}

function childOptions(options, embeddedNode) {
  const normalized = typeof options === "string"
    ? { encoding: options }
    : { ...(options ?? {}) };
  return {
    ...normalized,
    env: childEnvironment(options?.env, embeddedNode),
  };
}

const originalSpawn = childProcess.spawn;
childProcess.spawn = function spawn(file, args, options) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  const embeddedNode =
    !usesShell(options) && isEmbeddedNodeExecutable(file);
  return originalSpawn.call(
    this,
    file,
    embeddedNode ? withBootstrap(args) : [...args],
    childOptions(options, embeddedNode),
  );
};

const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function spawnSync(file, args, options) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  const embeddedNode =
    !usesShell(options) && isEmbeddedNodeExecutable(file);
  return originalSpawnSync.call(
    this,
    file,
    embeddedNode ? withBootstrap(args) : [...args],
    childOptions(options, embeddedNode),
  );
};

function parsedExecFileArguments(rest) {
  const pending = [...rest];
  const args = Array.isArray(pending[0]) ? pending.shift() : [];
  const options = typeof pending[0] === "function"
    ? undefined
    : pending.shift();
  const callback = pending.shift();
  return { args, callback, options };
}

function promisifiedChildProcess(wrapper) {
  Object.defineProperty(wrapper, promisify.custom, {
    configurable: true,
    value(...args) {
      let child;
      const promise = new Promise((resolve, reject) => {
        child = wrapper(...args, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
      promise.child = child;
      return promise;
    },
  });
  return wrapper;
}

const originalExecFile = childProcess.execFile;
childProcess.execFile = promisifiedChildProcess(
  function execFile(file, ...rest) {
    const { args, callback, options } =
      parsedExecFileArguments(rest);
    const embeddedNode =
      !usesShell(options) && isEmbeddedNodeExecutable(file);
    const nextArgs = embeddedNode ? withBootstrap(args) : [...args];
    const nextOptions = childOptions(options, embeddedNode);
    return typeof callback === "function"
      ? originalExecFile.call(
          this,
          file,
          nextArgs,
          nextOptions,
          callback,
        )
      : originalExecFile.call(this, file, nextArgs, nextOptions);
  },
);

const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = function execFileSync(
  file,
  args,
  options,
) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  const embeddedNode =
    !usesShell(options) && isEmbeddedNodeExecutable(file);
  return originalExecFileSync.call(
    this,
    file,
    embeddedNode ? withBootstrap(args) : [...args],
    childOptions(options, embeddedNode),
  );
};

const originalExec = childProcess.exec;
childProcess.exec = promisifiedChildProcess(
  function exec(command, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    const nextOptions = childOptions(options, false);
    return typeof callback === "function"
      ? originalExec.call(this, command, nextOptions, callback)
      : originalExec.call(this, command, nextOptions);
  },
);

const originalExecSync = childProcess.execSync;
childProcess.execSync = function execSync(command, options) {
  return originalExecSync.call(
    this,
    command,
    childOptions(options, false),
  );
};

const originalFork = childProcess.fork;
childProcess.fork = function fork(modulePath, args, options) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  const execPath = options?.execPath ?? process.execPath;
  const embeddedNode = isEmbeddedNodeExecutable(execPath);
  const nextOptions = childOptions(options, embeddedNode);
  if (embeddedNode) {
    nextOptions.execPath = execPath;
    nextOptions.execArgv = withBootstrap(
      options?.execArgv ?? process.execArgv,
    );
  }
  return originalFork.call(this, modulePath, [...args], nextOptions);
};

for (const name of controls) deleteEnvironmentName(process.env, name);
process.env.MINKE_NODE_BOOTSTRAP = bootstrapPath;
syncBuiltinESMExports();
`,
    dsh: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
if [ "\${${interactiveNodeOptionsName}+x}" != x ] && [ "\${NODE_OPTIONS+x}" = x ]; then
  export ${interactiveNodeOptionsName}="$NODE_OPTIONS"
fi
if [ "\${${interactiveNodePathName}+x}" != x ] && [ "\${NODE_PATH+x}" = x ]; then
  export ${interactiveNodePathName}="$NODE_PATH"
fi
runtime_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec env -u NODE_OPTIONS -u NODE_PATH ${modeName}=1 "${shellReference(executableName)}" --expose-internals "$runtime_root/index.mjs" "$@"
`,
    node: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
runtime_bin="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec env -u NODE_OPTIONS -u NODE_PATH ${modeName}=1 "${shellReference(executableName)}" --require "$runtime_bin/${environmentBootstrapName}" "$@"
`,
    pnpm: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
: "${shellRequirement(pnpmEntryName)}"
runtime_bin="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec env -u NODE_OPTIONS -u NODE_PATH ${modeName}=1 "${shellReference(executableName)}" --require "$runtime_bin/${environmentBootstrapName}" "${shellReference(pnpmEntryName)}" "$@"
`,
    pnpx: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
: "${shellRequirement(pnpmEntryName)}"
runtime_bin="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec env -u NODE_OPTIONS -u NODE_PATH ${modeName}=1 "${shellReference(executableName)}" --require "$runtime_bin/${environmentBootstrapName}" "${shellReference(pnpmEntryName)}" dlx "$@"
`,
    "node.cmd":
      `@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" --require "%~dp0${environmentBootstrapName}" %*\r\nexit /b %errorlevel%\r\n`,
    "pnpm.cmd":
      `@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" --require "%~dp0${environmentBootstrapName}" "${cmdReference(pnpmEntryName)}" %*\r\nexit /b %errorlevel%\r\n`,
    "pnpx.cmd":
      `@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" --require "%~dp0${environmentBootstrapName}" "${cmdReference(pnpmEntryName)}" dlx %*\r\nexit /b %errorlevel%\r\n`,
    "dsh.cmd":
      `@echo off\r\nsetlocal\r\nif not defined ${interactiveNodeOptionsName} if defined NODE_OPTIONS set "${interactiveNodeOptionsName}=%NODE_OPTIONS%"\r\nif not defined ${interactiveNodePathName} if defined NODE_PATH set "${interactiveNodePathName}=%NODE_PATH%"\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" --expose-internals "%~dp0..\\index.mjs" %*\r\nexit /b %errorlevel%\r\n`,
  };
}
