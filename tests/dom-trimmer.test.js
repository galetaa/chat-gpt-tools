"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const domTrimmer = require("../Extension/content/dom-trimmer.js");

test("DOM fallback keeps only the requested recent turns", () => {
  assert.equal(domTrimmer.retainedStart(12, 10), 2);
  assert.equal(domTrimmer.retainedStart(12, 20), 0);
  assert.equal(domTrimmer.retainedStart(120, 100), 20);
});

test("DOM fallback clamps its limit to the browser slider bounds", () => {
  assert.equal(domTrimmer.clampLimit(0), 1);
  assert.equal(domTrimmer.clampLimit(101), 100);
  assert.equal(domTrimmer.clampLimit("not-a-number"), 10);
});

test("live DOM stats retain messages removed by the early network trim", () => {
  assert.deepEqual(domTrimmer.mergeNetworkAndDomStats(
    { totalBefore: 100, keptAfter: 10, removed: 90, limit: 10 },
    { totalBefore: 10, keptAfter: 4, removed: 6, limit: 4 }
  ), {
    totalBefore: 100,
    keptAfter: 4,
    removed: 96,
    limit: 4
  });

  assert.deepEqual(domTrimmer.mergeNetworkAndDomStats(null, {
    totalBefore: 8,
    keptAfter: 3,
    removed: 5,
    limit: 3
  }), {
    totalBefore: 8,
    keptAfter: 3,
    removed: 5,
    limit: 3
  });
});

test("DOM fallback reapplies a changed limit without reloading the document", () => {
  const turns = Array.from({ length: 4 }, () => {
    const attributes = new Set();
    return {
      matches: () => true,
      querySelector: () => null,
      setAttribute: (name) => attributes.add(name),
      removeAttribute: (name) => attributes.delete(name),
      hasAttribute: (name) => attributes.has(name)
    };
  });
  const scheduled = new Map();
  let nextTimer = 1;
  const flushTimers = () => {
    const callbacks = [...scheduled.values()];
    scheduled.clear();
    callbacks.forEach((callback) => callback());
  };
  const root = {
    document: {
      body: {},
      addEventListener() {},
      querySelectorAll(selector) {
        return selector.includes("data-ct-dom-trimmed")
          ? turns.filter((turn) => turn.hasAttribute("data-ct-dom-trimmed"))
          : turns;
      }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      const timer = nextTimer++;
      scheduled.set(timer, callback);
      return timer;
    },
    clearTimeout(timer) {
      scheduled.delete(timer);
    }
  };
  const stats = [];
  const controller = domTrimmer.createController({
    onStats: (value) => stats.push(value)
  });

  // Use the test root instead of Node's global object.
  const originalDocument = global.document;
  const originalMutationObserver = global.MutationObserver;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.document = root.document;
  global.MutationObserver = root.MutationObserver;
  global.setTimeout = root.setTimeout;
  global.clearTimeout = root.clearTimeout;

  try {
    controller.enable(3);
    flushTimers();
    assert.deepEqual(turns.map((turn) => turn.hasAttribute("data-ct-dom-trimmed")), [
      true,
      false,
      false,
      false
    ]);

    controller.setLimit(1);
    flushTimers();
    assert.deepEqual(turns.map((turn) => turn.hasAttribute("data-ct-dom-trimmed")), [
      true,
      true,
      true,
      false
    ]);

    controller.setLimit(4);
    flushTimers();
    assert.deepEqual(turns.map((turn) => turn.hasAttribute("data-ct-dom-trimmed")), [
      false,
      false,
      false,
      false
    ]);
    assert.deepEqual(stats.map(({ keptAfter, removed }) => ({ keptAfter, removed })), [
      { keptAfter: 3, removed: 1 },
      { keptAfter: 1, removed: 3 },
      { keptAfter: 4, removed: 0 }
    ]);
  } finally {
    controller.teardown();
    global.document = originalDocument;
    global.MutationObserver = originalMutationObserver;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
