"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const domTrimmer = require("../Extension/content/dom-trimmer.js");

test("DOM fallback keeps only the requested recent turns", () => {
  assert.equal(domTrimmer.retainedStart(12, 10), 2);
  assert.equal(domTrimmer.retainedStart(12, 20), 0);
  assert.equal(domTrimmer.retainedStart(120, 100), 20);
});

test("DOM fallback clamps its limit to the Safari slider bounds", () => {
  assert.equal(domTrimmer.clampLimit(0), 1);
  assert.equal(domTrimmer.clampLimit(101), 100);
  assert.equal(domTrimmer.clampLimit("not-a-number"), 10);
});
