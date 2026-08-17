const { writeSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join } = require("node:path");

const expectedOutput = "minke-pty-ok";

function nodePtyProbeInvocation({
  comspec = process.env.ComSpec,
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  if (platform === "win32") {
    return {
      args: ["/d", "/c", "echo", expectedOutput],
      command:
        typeof comspec === "string" && comspec.length > 0
          ? comspec
          : "cmd.exe",
    };
  }
  return {
    args: ["--eval", `process.stdout.write('${expectedOutput}')`],
    command: execPath,
  };
}

function main() {
  const runtimeRoot = process.argv[2];
  if (typeof runtimeRoot !== "string" || runtimeRoot.length === 0) {
    throw new Error("usage: node-pty-probe.cjs <runtime-root>");
  }
  const runtimeRequire = createRequire(join(runtimeRoot, "package.json"));
  const pty = runtimeRequire("node-pty");
  const invocation = nodePtyProbeInvocation();
  let output = "";
  let settled = false;
  let timeout;

  function finish(code, message) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (message !== undefined) writeSync(2, `${message}\n`);
    process.exit(code);
  }

  timeout = setTimeout(() => {
    finish(1, `node-pty probe timed out, output ${JSON.stringify(output)}`);
  }, 10_000);

  let terminal;
  try {
    terminal = pty.spawn(invocation.command, invocation.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (error) {
    finish(
      1,
      `node-pty probe could not spawn: ${
        error instanceof Error ? error.stack : String(error)
      }`,
    );
    return;
  }
  terminal.onData((data) => {
    output += data;
  });
  terminal.onExit(({ exitCode }) => {
    setTimeout(() => {
      if (exitCode === 0 && output.includes(expectedOutput)) {
        finish(0);
        return;
      }
      finish(
        1,
        `node-pty probe failed: exit ${String(exitCode)}, output ${JSON.stringify(output)}`,
      );
    }, 25);
  });
}

module.exports = { nodePtyProbeInvocation };

if (require.main === module) main();
