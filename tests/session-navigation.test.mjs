import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionNavigationHistory,
} from "@minke/harness-overlay/client/session-navigation.ts";

function historyHarness() {
  const opened = [];
  let history;
  history = new SessionNavigationHistory((sessionId) => {
    opened.push(sessionId);
    history.observe(sessionId);
  });
  return { history, opened };
}

test("session navigation walks backward and forward through selection history", () => {
  const { history, opened } = historyHarness();
  history.observe("a");
  history.observe("b");
  history.observe("c");

  assert.equal(history.canBack, true);
  assert.equal(history.canForward, false);

  assert.equal(history.back(), true);
  assert.equal(history.canForward, true);
  assert.equal(history.back(), true);
  assert.equal(history.forward(), true);
  assert.deepEqual(opened, ["b", "a", "b"]);
});

test("a new selection after going back replaces the forward branch", () => {
  const { history, opened } = historyHarness();
  history.observe("a");
  history.observe("b");
  history.observe("c");
  history.back();

  history.observe("d");
  assert.equal(history.forward(), false);
  assert.equal(history.back(), true);
  assert.equal(history.forward(), true);
  assert.deepEqual(opened, ["b", "b", "d"]);
});

test("back from the no-session surface returns to the last session", () => {
  const { history, opened } = historyHarness();
  history.observe("a");
  history.observe("b");
  history.observe(undefined);

  assert.equal(history.canBack, true);
  assert.equal(history.back(), true);
  assert.deepEqual(opened, ["b"]);
});

test("a failed navigation leaves the history cursor unchanged", () => {
  const opened = [];
  const history = new SessionNavigationHistory((sessionId) => {
    opened.push(sessionId);
    throw new Error("session disappeared");
  });
  history.observe("a");
  history.observe("b");

  assert.equal(history.back(), false);
  assert.equal(history.forward(), false);
  assert.deepEqual(opened, ["a"]);
});
