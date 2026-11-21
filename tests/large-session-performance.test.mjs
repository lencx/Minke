import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
  verifyHarnessRuntimePatchesApplied,
} from "../scripts/harness/runtime-patches.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const performancePatch =
  "patches/deepseek-harness/large-session-performance.patch";
// Keep the generated-bundle line anchor exercised by the runtime patch.
const chatFixturePrefixLines = 4226;

const sessionFixture = `/** Minimum message count for ordinary history windows. */
export const PAGE_MESSAGES = 50;
const HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: PAGE_MESSAGES, minTurns: 2 } };
/** Minimum messages per page while a turn jump loops backwards. */
export const JUMP_PAGE_MESSAGES = 200;
export function initialHistoryOptions() { return HISTORY_PAGE_OPTIONS; }
`;

const chatFixture = `const react_jsx_runtime = {
  jsx(type, props) { return { type, props }; },
};
const GroupMembers = Symbol("GroupMembers");
const ChatGroupSeat_module_css_default = { content: "content" };
export function renderGroupBody(grouped, open, props = {}, members = []) {
			return (0, react_jsx_runtime.jsx)("div", {
				children: [(0, react_jsx_runtime.jsx)("div", {
					children: (0, react_jsx_runtime.jsx)("div", {
						ref: null,
						className: ChatGroupSeat_module_css_default.content,
						"data-step-process-content": true,
						"data-chat-flow": "",
						children: (0, react_jsx_runtime.jsx)(GroupMembers, {
							...props,
							members
						})
					})
				})]
			});
}
`;

async function withPatchedRuntime(callback) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-large-session-"));
  const sessionPath = join(
    runtimeRoot,
    "node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/session.js",
  );
  const chatPath = join(
    runtimeRoot,
    "node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js",
  );
  try {
    await mkdir(dirname(sessionPath), { recursive: true });
    await mkdir(dirname(chatPath), { recursive: true });
    await writeFile(join(runtimeRoot, "package.json"), '{"type":"module"}\n');
    await writeFile(sessionPath, sessionFixture);
    await writeFile(chatPath, `${"\n".repeat(chatFixturePrefixLines)}${chatFixture}`);
    const patches = await resolveHarnessRuntimePatches(
      projectRoot,
      [performancePatch],
    );
    await applyHarnessRuntimePatches(runtimeRoot, patches);
    await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);
    await callback({ chatPath, sessionPath });
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test("large sessions open with a bounded history window", async () => {
  await withPatchedRuntime(async ({ sessionPath }) => {
    const session = await import(pathToFileURL(sessionPath));
    assert.equal(session.initialHistoryOptions().maxMessages, 100);
  });
});

test("collapsed process groups defer their member rows", async () => {
  await withPatchedRuntime(async ({ chatPath }) => {
    const chat = await import(pathToFileURL(chatPath));
    const members = (grouped, open) =>
      chat.renderGroupBody(grouped, open)
        .props.children[0].props.children.props.children;
    assert.equal(members(true, false), null);
    assert.notEqual(members(true, true), null);
    assert.notEqual(members(false, false), null);
  });
});
