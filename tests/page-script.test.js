"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "../Extension");
const trimCoreSource = fs.readFileSync(
  path.join(extensionRoot, "scripts/trim-core.js"),
  "utf8"
);
const pageScriptSource = fs.readFileSync(
  path.join(extensionRoot, "scripts/page-script.js"),
  "utf8"
);

function conversation() {
  const roles = ["system", "user", "assistant", "user", "assistant"];
  const mapping = {};

  roles.forEach((role, index) => {
    const id = `n${index}`;
    mapping[id] = {
      id,
      parent: index === 0 ? null : `n${index - 1}`,
      children: index + 1 < roles.length ? [`n${index + 1}`] : [],
      message: {
        author: { role },
        content: { content_type: "text", parts: [id] }
      }
    };
  });

  return {
    title: "Integration test",
    mapping,
    current_node: "n4"
  };
}

function createPageRuntime(payload) {
  const eventTarget = new EventTarget();
  const statuses = [];
  const navigations = [];
  let fetchCalls = 0;
  const pageLocation = new URL("https://chatgpt.com/c/test");

  eventTarget.addEventListener("lightsession-status", (event) => {
    statuses.push(JSON.parse(event.detail));
  });
  eventTarget.addEventListener("lightsession-navigation", () => {
    navigations.push(pageLocation.href);
  });

  const history = {
    pushState(_state, _title, url) {
      if (url) {
        pageLocation.href = new URL(url, pageLocation).href;
      }
    },
    replaceState(_state, _title, url) {
      if (url) {
        pageLocation.href = new URL(url, pageLocation).href;
      }
    }
  };

  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    CustomEvent,
    console,
    location: pageLocation,
    history,
    setTimeout,
    clearTimeout,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    postMessage() {},
    fetch: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  vm.runInContext(trimCoreSource, context, { filename: "trim-core.js" });
  vm.runInContext(pageScriptSource, context, { filename: "page-script.js" });

  return {
    context,
    statuses,
    navigations,
    get fetchCalls() {
      return fetchCalls;
    },
    configure(value) {
      eventTarget.dispatchEvent(new CustomEvent("lightsession-config", {
        detail: JSON.stringify(value)
      }));
    }
  };
}

test("page interceptor trims a matching ChatGPT JSON response", async () => {
  const runtime = createPageRuntime(conversation());
  runtime.configure({ enabled: true, limit: 2, debug: false });

  const response = await runtime.context.fetch(
    "https://chatgpt.com/backend-api/conversation/test-id"
  );
  const result = await response.json();

  assert.equal(runtime.fetchCalls, 1);
  assert.deepEqual(Object.keys(result.mapping), ["n0", "n3", "n4"]);
  assert.deepEqual(runtime.statuses, [{
    totalBefore: 4,
    keptAfter: 2,
    removed: 2,
    limit: 2
  }]);
});

test("disabled interceptor returns the original conversation", async () => {
  const payload = conversation();
  const runtime = createPageRuntime(payload);
  runtime.configure({ enabled: false, limit: 1, debug: false });

  const response = await runtime.context.fetch(
    "https://chatgpt.com/backend-api/conversation/test-id"
  );
  const result = await response.json();

  assert.deepEqual(Object.keys(result.mapping), Object.keys(payload.mapping));
  assert.deepEqual(runtime.statuses, []);
});

test("non-conversation requests bypass parsing and trimming", async () => {
  const payload = conversation();
  const runtime = createPageRuntime(payload);
  runtime.configure({ enabled: true, limit: 1, debug: false });

  const response = await runtime.context.fetch("https://chatgpt.com/backend-api/models");
  const result = await response.json();

  assert.deepEqual(Object.keys(result.mapping), Object.keys(payload.mapping));
  assert.deepEqual(runtime.statuses, []);
});

test("page bridge reports SPA navigation without a polling timer", () => {
  const runtime = createPageRuntime(conversation());

  runtime.context.history.pushState({}, "", "/c/next");
  runtime.context.history.replaceState({}, "", "/c/next?model=fast");
  runtime.context.history.replaceState({}, "", "/c/next?model=fast");

  assert.deepEqual(runtime.navigations, [
    "https://chatgpt.com/c/next",
    "https://chatgpt.com/c/next?model=fast"
  ]);
});
