import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentBrowserProgressPolicy,
} from "../packages/harness-overlay/src/host/agent-browser-progress-policy.ts";

function call(
  operation,
  payload,
  {
    ownerId = "owner-1",
    sessionId = "browser-1",
    pageId = "snapshot-1",
  } = {},
) {
  return {
    ownerId,
    sessionId,
    pageId,
    operation,
    payload,
  };
}

test("successful refinements cannot be replayed on the same page epoch", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const find = call("find", {
    sessionId: "browser-1",
    query: { text: "comments" },
  });

  assert.equal(policy.preflight(find), undefined);
  assert.equal(
    policy.recordOutcome(find, {
      kind: "success",
      key: "find:snapshot-1:e8",
      progress: true,
    }),
    undefined,
  );
  assert.equal(
    policy.preflight({
      ...find,
      pageId: "snapshot-2",
    }),
    undefined,
  );
  assert.equal(policy.preflight(find)?.code, "find_repeated");
});

test("one bounded trace detects stable cross-operation ping-pong", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const click = call("click", {
    sessionId: "browser-1",
    target: { ref: "snapshot-1:e8" },
  });
  const find = call("find", {
    sessionId: "browser-1",
    query: { text: "comment link" },
  });

  assert.equal(
    policy.recordOutcome(click, {
      kind: "rejection",
      key: "find_required",
    }),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(find, {
      kind: "absence",
      key: "find:snapshot-1:none",
    }),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(click, {
      kind: "rejection",
      key: "find_required",
    }),
    undefined,
  );
  const stopped = policy.recordOutcome(find, {
    kind: "absence",
    key: "find:snapshot-1:none",
  });

  assert.equal(stopped?.code, "ping_pong_loop");
  assert.match(stopped?.message ?? "", /state cycle/iu);
});

test("stable successful state oscillation is not mistaken for progress", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const first = call("navigate", {
    sessionId: "browser-1",
    url: "https://example.com/a",
  });
  const second = call("navigate", {
    sessionId: "browser-1",
    url: "https://example.com/b",
  });

  assert.equal(
    policy.recordOutcome(first, {
      kind: "success",
      key: "url:https://example.com/a",
      progress: true,
    }),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(second, {
      kind: "success",
      key: "url:https://example.com/b",
      progress: true,
    }),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(first, {
      kind: "success",
      key: "url:https://example.com/a",
      progress: true,
    }),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(second, {
      kind: "success",
      key: "url:https://example.com/b",
      progress: true,
    })?.code,
    "ping_pong_loop",
  );
});

test("location cycles survive observations and changing page epochs", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const record = (
    operation,
    pageId,
    currentUrl,
  ) =>
    policy.recordOutcome(
      call(
        operation,
        operation === "navigate"
          ? { url: currentUrl }
          : { sessionId: "browser-1" },
        { pageId },
      ),
      {
        kind: "success",
        key: `${operation}:${pageId}`,
        progress: true,
        currentUrl,
      },
    );

  assert.equal(
    record(
      "navigate",
      "snapshot-0",
      "https://example.com/a",
    ),
    undefined,
  );
  assert.equal(
    record(
      "snapshot",
      "snapshot-1",
      "https://example.com/a",
    ),
    undefined,
  );
  assert.equal(
    record(
      "navigate",
      "snapshot-1",
      "https://example.com/b",
    ),
    undefined,
  );
  assert.equal(
    record(
      "snapshot",
      "snapshot-2",
      "https://example.com/b",
    ),
    undefined,
  );
  assert.equal(
    record(
      "navigate",
      "snapshot-2",
      "https://example.com/a",
    ),
    undefined,
  );
  assert.equal(
    record(
      "snapshot",
      "snapshot-3",
      "https://example.com/a",
    ),
    undefined,
  );
  assert.equal(
    record(
      "navigate",
      "snapshot-3",
      "https://example.com/b",
    )?.code,
    "ping_pong_loop",
  );
});

test("an exact successful call with the same resulting state is not progress", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const navigate = call("navigate", {
    sessionId: "browser-1",
    url: "https://example.com/already-here",
  });
  const outcome = {
    kind: "success",
    key: "url:https://example.com/already-here",
    progress: true,
  };

  assert.equal(
    policy.recordOutcome(navigate, outcome),
    undefined,
  );
  assert.equal(
    policy.recordOutcome(navigate, outcome)?.code,
    "repeated_operation",
  );
});

test("an already satisfied wait cannot be used as an infinite progress reset", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const wait = call("wait", {
    sessionId: "browser-1",
    text: "Ready",
    timeoutMs: 1_000,
  });

  policy.recordOutcome(wait, {
    kind: "success",
    key: "visible:Ready",
    progress: true,
  });
  assert.equal(
    policy.preflight(wait)?.code,
    "repeated_operation",
  );
});

test("screenshots deduplicate only without an intervening operation", () => {
  const screenshot = call("screenshot", {
    sessionId: "browser-1",
  });
  const outcome = {
    kind: "success",
    key: "screenshot:snapshot-1",
    progress: true,
  };
  const immediate = new AgentBrowserProgressPolicy();
  immediate.enterTurn("owner-1", 1);
  immediate.recordOutcome(screenshot, outcome);
  assert.equal(
    immediate.preflight(screenshot)?.code,
    "repeated_operation",
  );

  const afterProgress = new AgentBrowserProgressPolicy();
  afterProgress.enterTurn("owner-1", 1);
  afterProgress.recordOutcome(screenshot, outcome);
  afterProgress.recordOutcome(
    call("navigate", {
      sessionId: "browser-1",
      url: "https://example.com/next",
    }),
    {
      kind: "success",
      key: "navigate:https://example.com/next",
      progress: true,
    },
  );
  assert.equal(afterProgress.preflight(screenshot), undefined);
});

test("genuine progress breaks the global no-progress streak", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const first = call("click", {
    sessionId: "browser-1",
    target: { ref: "snapshot-1:e1" },
  });
  const second = call("click", {
    sessionId: "browser-1",
    target: { ref: "snapshot-1:e2" },
  });
  const third = call("click", {
    sessionId: "browser-1",
    target: { ref: "snapshot-1:e3" },
  });
  const fourth = call("find", {
    sessionId: "browser-1",
    query: { text: "resolved" },
  });

  for (const candidate of [first, second, third]) {
    assert.equal(
      policy.recordOutcome(candidate, {
        kind: "rejection",
        key: "action_evidence_required",
      }),
      undefined,
    );
  }
  assert.equal(
    policy.recordOutcome(fourth, {
      kind: "success",
      key: "find:snapshot-1:e4",
      progress: true,
    }),
    undefined,
  );
  assert.equal(
    policy.preflight(call("click", {
      sessionId: "browser-1",
      target: { ref: "snapshot-1:e5" },
    })),
    undefined,
  );
});

test("find and generated locator calls share one weighted refinement budget", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);

  for (let index = 0; index < 5; index += 1) {
    const find = call("find", {
      sessionId: "browser-1",
      query: { text: `candidate-${String(index)}` },
    });
    assert.equal(policy.preflight(find), undefined);
    policy.recordOutcome(find, {
      kind: "success",
      key: `find:snapshot-1:e${String(index)}`,
      progress: true,
    });
  }
  assert.equal(
    policy.preflight(call("find", {
      sessionId: "browser-1",
      query: { text: "candidate-6" },
    }))?.code,
    "find_exhausted",
  );

  policy.enterTurn("owner-1", 2);
  for (let index = 0; index < 3; index += 1) {
    const locate = call("locate", {
      sessionId: "browser-1",
      code: `page.locator("tr").nth(${String(index)})`,
    });
    assert.equal(policy.preflight(locate), undefined);
    policy.recordOutcome(locate, {
      kind: "success",
      key: `locate:snapshot-1:e${String(index)}`,
      progress: true,
    });
  }
  assert.equal(
    policy.preflight(call("locate", {
      sessionId: "browser-1",
      code: 'page.getByRole("button")',
    }))?.code,
    "locate_exhausted",
  );
});

test("known identical failures stop before a redundant retry and new turns reset only liveness", () => {
  const policy = new AgentBrowserProgressPolicy();
  policy.enterTurn("owner-1", 1);
  const click = call("click", {
    sessionId: "browser-1",
    target: { ref: "snapshot-1:e1" },
  });

  policy.recordOutcome(click, {
    kind: "failure",
    key: "element_not_found",
    retryable: false,
  });
  assert.equal(
    policy.preflight(click)?.code,
    "repeated_operation",
  );

  policy.enterTurn("owner-1", 2);
  assert.equal(policy.preflight(click), undefined);
});
