import assert from "node:assert/strict";
import test from "node:test";
import {
  agentBrowserSuccessResponse,
  createAgentBrowserReleaseOwnerRequest,
  createAgentBrowserRequest,
  isAgentBrowserProcessMessage,
  parseAgentBrowserProcessRequest,
  parseAgentBrowserProjection,
  parseAgentBrowserProjections,
} from "@minke/harness-overlay/agent-browser-contract.ts";

test("Agent Browser process requests are exact, bounded, and owner-scoped", () => {
  const request = createAgentBrowserRequest(
    7,
    "conversation-1",
    "navigate",
    {
      sessionId: "browser-1",
      url: "https://example.com/docs",
    },
  );
  assert.deepEqual(request, {
    channel: "minke:agent-browser:process",
    protocolVersion: 1,
    requestId: 7,
    type: "request",
    operation: "navigate",
    ownerSessionId: "conversation-1",
    payload: {
      sessionId: "browser-1",
      url: "https://example.com/docs",
    },
  });
  assert.deepEqual(parseAgentBrowserProcessRequest(request), request);
  assert.equal(isAgentBrowserProcessMessage(request), true);
  assert.equal(
    isAgentBrowserProcessMessage({
      ...request,
      channel: "minke:harness-control",
    }),
    false,
  );

  assert.throws(
    () =>
      parseAgentBrowserProcessRequest({
        ...request,
        unexpected: true,
      }),
    /invalid Agent Browser process request/u,
  );
  assert.throws(
    () =>
      createAgentBrowserRequest(8, "conversation/escape", "open", {
        url: "https://example.com/",
      }),
    /owner session id/u,
  );
  assert.throws(
    () =>
      createAgentBrowserRequest(9, "conversation-1", "open", {
        url: "file:///tmp/private",
      }),
    /invalid Agent Browser URL/u,
  );
});

test("Agent Browser owner release is an exact one-way lifecycle frame", () => {
  const request = createAgentBrowserReleaseOwnerRequest(
    "conversation-release",
  );
  assert.deepEqual(request, {
    channel: "minke:agent-browser:process",
    protocolVersion: 1,
    type: "release-owner",
    ownerSessionId: "conversation-release",
  });
  assert.deepEqual(parseAgentBrowserProcessRequest(request), request);
  assert.throws(
    () =>
      parseAgentBrowserProcessRequest({
        ...request,
        requestId: 10,
      }),
    /release owner request/u,
  );
});

test("Agent Browser renderer projections reject persistent identity", () => {
  const projection = parseAgentBrowserProjection({
    sessionId: "browser-1",
    partition: "minke-agent-4bb22c",
    generation: 1,
    owner: "agent",
    status: "pending",
    url: "https://example.com/",
    cursor: {
      sequence: 1,
      phase: "moving",
      point: { x: 320.5, y: 240.25 },
      viewport: { width: 860, height: 863 },
      durationMs: 180,
    },
  });
  assert.equal(projection.partition, "minke-agent-4bb22c");
  assert.deepEqual(projection.cursor, {
    sequence: 1,
    phase: "moving",
    point: { x: 320.5, y: 240.25 },
    viewport: { width: 860, height: 863 },
    durationMs: 180,
  });
  assert.deepEqual(parseAgentBrowserProjections([projection]), [
    projection,
  ]);

  assert.throws(
    () =>
      parseAgentBrowserProjection({
        ...projection,
        partition: "persist:minke-tabs-web",
      }),
    /partition/u,
  );
  assert.throws(
    () => parseAgentBrowserProjections(new Array(33).fill(projection)),
    /projection list/u,
  );

  for (const cursor of [
    {
      ...projection.cursor,
      phase: "dragging",
    },
    {
      ...projection.cursor,
      point: { x: Number.NaN, y: 10 },
    },
    {
      ...projection.cursor,
      point: { x: -0.1, y: 10 },
    },
    {
      ...projection.cursor,
      point: { x: 861, y: 10 },
    },
    {
      ...projection.cursor,
      point: { x: 10, y: 864 },
    },
    {
      ...projection.cursor,
      viewport: { width: 0, height: 863 },
    },
    {
      ...projection.cursor,
      durationMs: 2_001,
    },
    {
      ...projection.cursor,
      unexpected: true,
    },
  ]) {
    assert.throws(
      () =>
        parseAgentBrowserProjection({
          ...projection,
          cursor,
        }),
      /cursor/u,
    );
  }
});

test("Agent Browser snapshot results expose only generation-bound refs", () => {
  const response = agentBrowserSuccessResponse(3, "snapshot", {
    sessionId: "browser-1",
    generation: 4,
    owner: "agent",
    status: "ready",
    url: "https://example.com/",
    snapshotId: "snapshot-4",
    nodes: [
      {
        ref: "s4:e1",
        role: "button",
        name: "Continue",
      },
    ],
  });
  assert.equal(response.type, "response");
  assert.equal(response.result.nodes[0].ref, "s4:e1");

  assert.throws(
    () =>
      agentBrowserSuccessResponse(4, "snapshot", {
        ...response.result,
        nodes: [
          {
            ref: "e1",
            role: "button",
            name: "Continue",
          },
        ],
      }),
    /ref/u,
  );
});
