import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { JSDOM } from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import { paginate, validateHistoryWindow } from "../vendor/deepseek-harness/packages/api/session-controller/lib/types/history.js";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
  verifyHarnessRuntimePatchesApplied,
} from "../scripts/harness/runtime-patches.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const upstream = join(projectRoot, "vendor/deepseek-harness/packages");
const performancePatch =
  "patches/deepseek-harness/large-session-performance.patch";
const sessionTarget =
  "node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js";
const chatTarget =
  "node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js";

async function copyTarget(runtimeRoot, source, target) {
  const path = join(runtimeRoot, target);
  await mkdir(dirname(path), { recursive: true });
  await copyFile(join(upstream, source), path);
  return path;
}

const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-large-session-"));
let sessionBundle;
let chatBundle;
try {
  const [sessionPath, chatPath] = await Promise.all([
    copyTarget(runtimeRoot, "api/session-controller/lib/client.js", sessionTarget),
    copyTarget(runtimeRoot, "client/ui-chat/lib/client.js", chatTarget),
  ]);
  // DSH hashes CSS module names using the absolute stylesheet path.
  const source = await readFile(chatPath, "utf8");
  const relocated = source.replace(
    /(MessageItem_module_css_default\s*=\s*\{\s*"attachmentRow":\s*`)[^`]+/u,
    "$1relocated_attachmentRow",
  );
  assert.notEqual(relocated, source, "the fixture varies the checkout-dependent CSS name");
  await writeFile(chatPath, relocated);
  const patches = await resolveHarnessRuntimePatches(projectRoot, [performancePatch]);
  await applyHarnessRuntimePatches(runtimeRoot, patches);
  await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);
  [sessionBundle, chatBundle] = await Promise.all([
    readFile(sessionPath, "utf8"),
    readFile(chatPath, "utf8"),
  ]);
} finally {
  await rm(runtimeRoot, { recursive: true, force: true });
}

test("ordinary history stays bounded while turn jumps retain a valid request", () => {
  // Git can write patched files with Windows line endings.
  const windowsBundle = sessionBundle.replace(/\r?\n/gu, "\r\n");
  const declaration = windowsBundle.match(
    /^  const HISTORY_PAGE_OPTIONS = .+\r?\n  const JUMP_PAGE_MESSAGES = .+\r?\n  const JUMP_PAGE_OPTIONS = .+/mu,
  )?.[0];
  assert.ok(declaration, "the session bundle declares both history windows");
  const { history, jump } = new Function(`
    ${declaration}
    return { history: HISTORY_PAGE_OPTIONS, jump: JUMP_PAGE_OPTIONS };
  `)();

  assert.deepEqual(history, { maxMessages: 100, turnWindow: { minMessages: 50, minTurns: 2 } });
  assert.deepEqual(jump, { maxMessages: 500, turnWindow: { minMessages: 200, minTurns: 2 } });
  assert.doesNotThrow(() => validateHistoryWindow(history));
  assert.doesNotThrow(() => validateHistoryWindow(jump));
  const journal = [
    { type: "turn/start", seq: 0 },
    ...Array.from({ length: 600 }, (_, index) => ({
      type: "assistant/message",
      seq: index + 1,
      surfaceOp: "append",
    })),
    { type: "turn/end", seq: 601 },
  ];
  const initial = paginate(journal, undefined, history.maxMessages, 601, history.turnWindow);
  assert.equal(initial.events[0].seq, 501);
  assert.equal(initial.hasMore, true);
  const older = paginate(journal, initial.events[0].seq, history.maxMessages, 601, history.turnWindow);
  assert.equal(older.events.length, 100);
  assert.equal(older.events.at(-1).seq, 500);
});

test("collapsed process groups defer members until first expansion and retain them afterward", async () => {
  const declaration = chatBundle.match(/^  const ChatGroupSeat = [\s\S]+?^  \}\);/mu)?.[0];
  assert.ok(declaration, "the chat bundle contains the process group component");
  const bindings = {
    react: React,
    react_jsx_runtime: jsx,
    ChatGroupSeat_module_css_default: { content: "content" },
    useDisclosure() {
      const [expanded, setExpanded] = React.useState(false);
      return { expanded, setExpanded };
    },
    useProcessScroll: () => ({ edges: {}, events: {}, initialize() {} }),
    ProcessGroupHeader: ({ open, toggle }) => jsx.jsx("button", {
      "aria-expanded": open,
      onClick: toggle,
    }),
    GroupMembers: () => jsx.jsx("input", { defaultValue: "original" }),
  };
  const ChatGroupSeat = new Function(
    ...Object.keys(bindings),
    `${declaration}\nreturn ChatGroupSeat;`,
  )(...Object.values(bindings));
  const group = { members: [{ key: "node-1" }], data: { turn: 1, closed: true } };
  const props = {
    groupKey: "group-1",
    useChatGroup: (_key, select) => select(group),
    usePresentation: select => select({ stepGrouping: "collapsed", foldCompletedTurns: false }),
    useChatNodeBottom: () => false,
    useChatNodeProcess: () => undefined,
    useChatNode: () => undefined,
    useStore: () => false,
    useGroupAction: () => React.useRef(null),
    useGroupHeaderAction() {},
  };

  const dom = new JSDOM('<div id="root"></div>');
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  let root;
  try {
    const { createRoot } = await import("react-dom/client");
    const container = document.getElementById("root");
    root = createRoot(container);
    await React.act(async () => { root.render(jsx.jsx(ChatGroupSeat, props)); });
    const button = container.querySelector("button");
    const member = () => container.querySelector("[data-step-process-content] input");

    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(member(), null);
    await React.act(async () => { button.click(); });
    const input = member();
    assert.ok(input);
    input.value = "retained draft";
    await React.act(async () => { button.click(); });
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(member(), input);
    await React.act(async () => { button.click(); });
    assert.equal(member()?.value, "retained draft");
  } finally {
    if (root) await React.act(async () => { root.unmount(); });
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
    dom.window.close();
  }
});
