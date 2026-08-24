import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  AgentBrowserCdp,
} from "@minke/desktop/main/agent-browser/cdp.ts";

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

class FakeDebugger extends EventEmitter {
  attached = false;
  commands = [];
  failures = new Map();

  attach(version) {
    assert.equal(version, "1.3");
    this.attached = true;
  }

  detach() {
    this.attached = false;
    this.emit("detach", {}, "closed");
  }

  isAttached() {
    return this.attached;
  }

  failNext(method) {
    this.failures.set(method, new Error(`${method} failed`));
  }

  async sendCommand(method, params = {}) {
    this.commands.push({ method, params });
    if (method === "Overlay.setInspectMode") {
      assert.equal(
        typeof params.highlightConfig,
        "object",
        "Chromium requires highlightConfig for every inspect mode",
      );
    }
    const failure = this.failures.get(method);
    if (failure !== undefined) {
      this.failures.delete(method);
      throw failure;
    }
    switch (method) {
      case "DOM.describeNode":
        return {
          node: {
            backendNodeId: params.backendNodeId,
            localName: "h3",
            nodeName: "H3",
            attributes: ["role", "heading"],
          },
        };
      case "Accessibility.getPartialAXTree":
        return {
          nodes: [{
            backendDOMNodeId: params.backendNodeId,
            ignored: false,
            role: { value: "heading" },
            name: { value: "Result title" },
          }],
        };
      case "DOM.getContentQuads":
        return {
          quads: [[20, 30, 220, 30, 220, 70, 20, 70]],
        };
      case "DOM.getBoxModel":
        return {
          model: {
            border: [20, 30, 220, 30, 220, 70, 20, 70],
          },
        };
      case "Page.getLayoutMetrics":
        return {
          cssVisualViewport: {
            clientWidth: 860,
            clientHeight: 863,
          },
        };
      case "DOM.resolveNode":
        return { object: { objectId: "node-1" } };
      case "Runtime.callFunctionOn":
        return {
          result: {
            value: {
              topDocument: true,
              tag: "h3",
              text: "Result title",
              ariaLabel: "",
              role: "",
              selector: "main > div:nth-of-type(2) > h3",
              path: "html > body > main > div > h3",
              viewportWidth: 860,
              viewportHeight: 863,
            },
          },
        };
      case "Page.captureScreenshot":
        return { data: "aGVsbG8=" };
      default:
        return {};
    }
  }
}

test("CDP picker keeps backend ids private and commits targets with pixels", async () => {
  const debuggerPort = new FakeDebugger();
  const cdp = new AgentBrowserCdp(debuggerPort);
  await cdp.attach();
  const targets = [];
  const endings = [];
  await cdp.startAnnotationPicker(
    (target) => {
      targets.push(target);
    },
    (reason, message) => {
      endings.push({ reason, message });
    },
  );
  assert.deepEqual(await cdp.annotationViewport(), {
    width: 860,
    height: 863,
  });

  debuggerPort.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 71 },
  );
  await settle();

  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetId, "target-1");
  assert.equal(targets[0].text, "Result title");
  assert.deepEqual(targets[0].rect, {
    x: 20,
    y: 30,
    width: 200,
    height: 40,
  });
  assert.equal("backendNodeId" in targets[0], false);
  assert.equal(
    debuggerPort.commands.filter(
      ({ method }) => method === "Runtime.releaseObjectGroup",
    ).length,
    1,
  );
  assert.equal(
    debuggerPort.commands.filter(
      ({ method, params }) =>
        method === "Overlay.setInspectMode" &&
        params.mode === "searchForNode",
    ).length,
    2,
    "selection must re-arm Chromium inspect mode",
  );

  const committed = await cdp.captureAnnotationTargets([
    targets[0].targetId,
  ]);
  assert.equal(committed.data, "aGVsbG8=");
  assert.equal(committed.targets.length, 1);
  const captureIndex = debuggerPort.commands.findIndex(
    ({ method }) => method === "Page.captureScreenshot",
  );
  const freezeIndex = debuggerPort.commands.findIndex(
    ({ method, params }) =>
      method === "Page.setWebLifecycleState" &&
      params.state === "frozen",
  );
  const resumeIndex = debuggerPort.commands.findIndex(
    ({ method, params }) =>
      method === "Page.setWebLifecycleState" &&
      params.state === "active",
  );
  const pauseIndex = debuggerPort.commands.findIndex(
    ({ method, params }) =>
      method === "Overlay.setInspectMode" &&
      params.mode === "none",
  );
  assert.ok(pauseIndex >= 0 && pauseIndex < captureIndex);
  assert.ok(freezeIndex > pauseIndex && freezeIndex < captureIndex);
  assert.ok(resumeIndex > captureIndex);

  debuggerPort.emit(
    "message",
    {},
    "DOM.documentUpdated",
    {},
  );
  await settle();
  assert.equal(endings.length, 1);
  assert.equal(endings[0].reason, "navigation");
  await assert.rejects(
    cdp.describeAnnotationTarget(targets[0].targetId),
    (error) => error.code === "stale_ref",
  );

  await cdp.stopAnnotationPicker();
  await cdp.stopAnnotationPicker();
  cdp.dispose();
});

test("CDP picker reuses a DOM target and never evicts saved comments at the public limit", async () => {
  const debuggerPort = new FakeDebugger();
  const cdp = new AgentBrowserCdp(debuggerPort);
  await cdp.attach();
  const targets = [];
  await cdp.startAnnotationPicker((target) => {
    targets.push(target);
  });

  debuggerPort.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 81 },
  );
  await settle();
  debuggerPort.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 81 },
  );
  await settle();
  assert.equal(targets.length, 2);
  assert.equal(
    targets[1].targetId,
    targets[0].targetId,
    "selecting the same DOM node must reopen its existing comment",
  );

  for (let backendNodeId = 100; backendNodeId < 133; backendNodeId += 1) {
    debuggerPort.emit(
      "message",
      {},
      "Overlay.inspectNodeRequested",
      { backendNodeId },
    );
  }
  await settle();
  assert.equal(targets.length, 35);
  assert.equal(
    (await cdp.describeAnnotationTarget(targets[0].targetId)).targetId,
    targets[0].targetId,
    "discarded drafts must not evict a saved target reference",
  );

  await cdp.stopAnnotationPicker();
  cdp.dispose();
});

test("a failed Overlay disable does not retain picker authority", async () => {
  const debuggerPort = new FakeDebugger();
  const cdp = new AgentBrowserCdp(debuggerPort);
  await cdp.attach();
  await cdp.startAnnotationPicker(() => {});
  debuggerPort.failNext("Overlay.disable");
  await assert.rejects(cdp.stopAnnotationPicker(), /Overlay.disable failed/u);

  // Negative control: a late selection from the failed stop cannot publish.
  let selected = false;
  debuggerPort.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 72 },
  );
  await settle();
  assert.equal(selected, false);

  await cdp.startAnnotationPicker(() => {
    selected = true;
  });
  debuggerPort.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 72 },
  );
  await settle();
  assert.equal(selected, true);
  cdp.dispose();
});
