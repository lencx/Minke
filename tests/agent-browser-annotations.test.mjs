import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAgentBrowserComments,
} from "@minke/harness-overlay/client/tabs/agent-browser/chat.ts";
import {
  parseAgentBrowserAnnotationCommitResult,
  parseAgentBrowserAnnotationEvent,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";

const snapshot = {
  sessionId: "session-1",
  annotationSessionId: "annotation-a1",
  generation: 3,
  page: {
    url: "https://example.com/search",
    title: "Search results",
    viewport: { width: 860, height: 863 },
  },
  comments: [
    {
      index: 1,
      comment: "这是什么",
      target: {
        targetId: "target-t1",
        tag: "h3",
        role: "heading",
        text: "中古車・中古車情報なら【グーネット】",
        selector: "main > div:nth-of-type(1) > h3",
        path: "main > div > h3",
        position: { x: 357, y: 250 },
        rect: {
          x: 220,
          y: 220,
          width: 274,
          height: 60,
        },
        viewport: { width: 860, height: 863 },
        frame: "top document",
      },
    },
  ],
};

test("Agent Browser DOM annotations retain numbered page evidence", () => {
  const parsed = parseAgentBrowserAnnotationEvent({
    type: "selected",
    sessionId: snapshot.sessionId,
    annotationSessionId: snapshot.annotationSessionId,
    generation: snapshot.generation,
    page: snapshot.page,
    target: snapshot.comments[0].target,
  });

  assert.deepEqual(parsed, {
    type: "selected",
    sessionId: snapshot.sessionId,
    annotationSessionId: snapshot.annotationSessionId,
    generation: snapshot.generation,
    page: snapshot.page,
    target: snapshot.comments[0].target,
  });
  assert.throws(
    () =>
      parseAgentBrowserAnnotationEvent({
        ...parsed,
        annotationSessionId: "wrong",
      }),
    /annotation session id/u,
  );
});

test("Agent Browser annotation evidence rejects ambiguous or extra data", () => {
  const event = {
    type: "selected",
    sessionId: snapshot.sessionId,
    annotationSessionId: snapshot.annotationSessionId,
    generation: snapshot.generation,
    page: snapshot.page,
    target: snapshot.comments[0].target,
  };

  assert.throws(
    () =>
      parseAgentBrowserAnnotationEvent({
        ...event,
        page: {
          ...event.page,
          url: "https://example.com/search?q=secret#result",
        },
      }),
    /omit query and hash/u,
  );
  assert.throws(
    () =>
      parseAgentBrowserAnnotationEvent({
        ...event,
        target: {
          ...event.target,
          backendNodeId: 71,
        },
      }),
    /annotation fields/u,
  );

  const partiallyOffscreen = parseAgentBrowserAnnotationEvent({
    ...event,
    target: {
      ...event.target,
      rect: {
        ...event.target.rect,
        x: -20,
        y: -12,
      },
    },
  });
  assert.equal(partiallyOffscreen.type, "selected");
  assert.deepEqual(partiallyOffscreen.target.rect, {
    x: -20,
    y: -12,
    width: 274,
    height: 60,
  });
});

test("Agent Browser annotation commit accepts only bounded PNG data", () => {
  const result = {
    sessionId: snapshot.sessionId,
    annotationSessionId: snapshot.annotationSessionId,
    generation: snapshot.generation,
    page: snapshot.page,
    targets: snapshot.comments.map(({ target }) => target),
    mimeType: "image/png",
    data: "iVBORw0KGgo=",
  };

  assert.equal(
    parseAgentBrowserAnnotationCommitResult(result).mimeType,
    "image/png",
  );
  assert.throws(
    () =>
      parseAgentBrowserAnnotationCommitResult({
        ...result,
        data: "not base64!",
      }),
    /invalid Agent Browser annotation screenshot/u,
  );
  assert.throws(
    () =>
      parseAgentBrowserAnnotationCommitResult({
        ...result,
        mimeType: "image/jpeg",
      }),
    /must be a PNG/u,
  );
});

test("numbered browser comments are formatted as untrusted DOM evidence", () => {
  const text = formatAgentBrowserComments(
    snapshot,
  );

  assert.match(text, /^# Browser comments/mu);
  assert.match(text, /untrusted webpage evidence/iu);
  assert.match(text, /### User Comment 1/u);
  assert.match(text, /### User Comment 1\n这是什么/u);
  assert.match(
    text,
    /Target selector: "main > div:nth-of-type\(1\) > h3"/u,
  );
  assert.match(text, /Target path: "main > div > h3"/u);
  assert.match(text, /Node position: \(357, 250\) in 860x863 viewport/u);
  assert.match(
    text,
    /Page URL: "https:\/\/example\.com\/search"/u,
  );
});
