import { embeddedNodeEnvironment } from "../../config/embedded-node-runtime.mts";

const executableName = embeddedNodeEnvironment.executable;
const pnpmEntryName = embeddedNodeEnvironment.pnpmEntry;
const modeName = embeddedNodeEnvironment.mode;

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
 * no ambient or standalone Node installation participates.
 */
export function runtimeAdapterSources() {
  return {
    node: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
exec env ${modeName}=1 "${shellReference(executableName)}" "$@"
`,
    pnpm: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
: "${shellRequirement(pnpmEntryName)}"
exec env ${modeName}=1 "${shellReference(executableName)}" "${shellReference(pnpmEntryName)}" "$@"
`,
    pnpx: `#!/bin/sh
set -eu
: "${shellRequirement(executableName)}"
: "${shellRequirement(pnpmEntryName)}"
exec env ${modeName}=1 "${shellReference(executableName)}" "${shellReference(pnpmEntryName)}" dlx "$@"
`,
    "node.cmd":
      `@echo off\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" %*\r\n`,
    "pnpm.cmd":
      `@echo off\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" "${cmdReference(pnpmEntryName)}" %*\r\n`,
    "pnpx.cmd":
      `@echo off\r\nset "${modeName}=1"\r\n"${cmdReference(executableName)}" "${cmdReference(pnpmEntryName)}" dlx %*\r\n`,
  };
}
