"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sharedSource = fs.readFileSync(
  path.resolve(__dirname, "../Extension/scripts/shared.js"),
  "utf8"
);

function createSharedRuntime(initialSettings) {
  const storage = { ls_settings: initialSettings };
  const browser = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    }
  };
  const context = vm.createContext({ browser, URL });
  vm.runInContext(sharedSource, context, { filename: "shared.js" });
  return { shared: context.LightSessionShared, storage };
}

test("standard mode defaults to a 1–20 range", () => {
  const { shared } = createSharedRuntime();
  const settings = shared.normalizeSettings({});

  assert.equal(settings.version, 2);
  assert.equal(settings.keep, 10);
  assert.equal(settings.extendedRange, false);
  assert.equal(shared.STANDARD_MAX_KEEP, 20);
  assert.equal(shared.MAX_KEEP, 100);
});

test("legacy values above 20 automatically migrate to extended range", () => {
  const { shared } = createSharedRuntime();
  const settings = shared.normalizeSettings({ version: 1, keep: 75 });

  assert.equal(settings.keep, 75);
  assert.equal(settings.extendedRange, true);
});

test("standard mode clamps invalid values while extended mode allows 100", () => {
  const { shared } = createSharedRuntime();

  assert.deepEqual(
    {
      keep: shared.normalizeSettings({ keep: 75, extendedRange: false }).keep,
      extendedRange:
        shared.normalizeSettings({ keep: 75, extendedRange: false })
          .extendedRange
    },
    { keep: 20, extendedRange: false }
  );
  assert.equal(
    shared.normalizeSettings({ keep: 500, extendedRange: true }).keep,
    100
  );
});

test("reading settings persists the migrated schema", async () => {
  const { shared, storage } = createSharedRuntime({ version: 1, keep: 30 });
  const settings = await shared.readSettings();

  assert.equal(settings.version, 2);
  assert.equal(settings.extendedRange, true);
  assert.deepEqual(storage.ls_settings, settings);
});
