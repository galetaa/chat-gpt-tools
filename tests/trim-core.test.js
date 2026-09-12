"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildActivePath,
  clampLimit,
  trimConversation
} = require("../Extension/scripts/trim-core.js");

function node(id, parent, role, children = []) {
  return {
    id,
    parent,
    children,
    message: {
      id: `message-${id}`,
      author: { role },
      content: { content_type: "text", parts: [id] }
    }
  };
}

function linearConversation(roles) {
  const mapping = {};
  let parent = null;

  roles.forEach((role, index) => {
    const id = `n${index}`;
    const child = index + 1 < roles.length ? `n${index + 1}` : null;
    mapping[id] = node(id, parent, role, child ? [child] : []);
    parent = id;
  });

  return {
    title: "Test conversation",
    mapping,
    current_node: `n${roles.length - 1}`
  };
}

test("clampLimit applies the shared browser UI bounds", () => {
  assert.equal(clampLimit(-10), 1);
  assert.equal(clampLimit(500), 100);
  assert.equal(clampLimit("25"), 25);
  assert.equal(clampLimit("invalid"), 10);
});

test("buildActivePath follows only the selected branch", () => {
  const conversation = linearConversation(["system", "user", "assistant"]);
  conversation.mapping.side = node("side", "n1", "assistant");
  conversation.mapping.n1.children.push("side");

  assert.deepEqual(
    buildActivePath(conversation.mapping, conversation.current_node),
    ["n0", "n1", "n2"]
  );
});

test("conversation under the limit is returned unchanged", () => {
  const conversation = linearConversation(["system", "user", "assistant"]);
  const result = trimConversation(conversation, 10);

  assert.equal(result.changed, false);
  assert.equal(result.conversation, conversation);
  assert.deepEqual(result.stats, {
    totalBefore: 2,
    keptAfter: 2,
    removed: 0,
    limit: 10
  });
});

test("trimming keeps the system root and last visible role groups", () => {
  const conversation = linearConversation([
    "system",
    "user",
    "assistant",
    "user",
    "assistant"
  ]);

  const result = trimConversation(conversation, 2);

  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.conversation.mapping), ["n0", "n3", "n4"]);
  assert.equal(result.conversation.root, "n0");
  assert.equal(result.conversation.current_node, "n4");
  assert.deepEqual(result.conversation.mapping.n0.children, ["n3"]);
  assert.equal(result.conversation.mapping.n3.parent, "n0");
  assert.deepEqual(result.stats, {
    totalBefore: 4,
    keptAfter: 2,
    removed: 2,
    limit: 2
  });
});

test("tool and thinking nodes do not consume the visible limit", () => {
  const conversation = linearConversation([
    "system",
    "user",
    "assistant",
    "tool",
    "thinking",
    "assistant",
    "user"
  ]);

  const result = trimConversation(conversation, 2);

  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.conversation.mapping), ["n0", "n2", "n5", "n6"]);
  assert.equal(result.stats.totalBefore, 3);
  assert.equal(result.stats.keptAfter, 2);
  assert.equal(result.stats.removed, 1);
});

test("consecutive nodes by the same author count as one visible group", () => {
  const conversation = linearConversation([
    "system",
    "user",
    "assistant",
    "assistant",
    "user"
  ]);
  const result = trimConversation(conversation, 2);

  assert.equal(result.stats.totalBefore, 3);
  assert.deepEqual(Object.keys(result.conversation.mapping), ["n0", "n2", "n3", "n4"]);
});

test("malformed and cyclic mappings fail open instead of breaking ChatGPT", () => {
  assert.equal(trimConversation(null, 10), null);
  assert.equal(trimConversation({ mapping: {}, current_node: "missing" }, 10), null);

  const cyclic = linearConversation(["user", "assistant"]);
  cyclic.mapping.n0.parent = "n1";
  assert.equal(trimConversation(cyclic, 1), null);
});
