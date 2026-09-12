"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extensionRoot = path.resolve(__dirname, "../Extension");
const popupSource = fs.readFileSync(
  path.join(extensionRoot, "popup/popup.js"),
  "utf8"
);
const contentSource = fs.readFileSync(
  path.join(extensionRoot, "content/content.js"),
  "utf8"
);

test("popup applies settings live and never reloads the active ChatGPT tab", () => {
  assert.doesNotMatch(popupSource, /tabs\.reload|location\.reload/);
  assert.match(popupSource, /chatgpt-tools:apply-settings/);
  assert.match(contentSource, /chatgpt-tools:apply-settings/);
  assert.match(contentSource, /applySettings\(message\.settings/);
});
