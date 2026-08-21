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
  const conversationResponses = [];
  let fetchCalls = 0;
  let intervalCallback = null;
  const pageLocation = new URL("https://chatgpt.com/c/test");

  eventTarget.addEventListener("lightsession-status", (event) => {
    statuses.push(JSON.parse(event.detail));
  });
  eventTarget.addEventListener("lightsession-navigation", () => {
    navigations.push(pageLocation.href);
  });
  eventTarget.addEventListener("chatgpt-tools-conversation", (event) => {
    conversationResponses.push(JSON.parse(event.detail));
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
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
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
    conversationResponses,
    get fetchCalls() {
      return fetchCalls;
    },
    configure(value) {
      eventTarget.dispatchEvent(new CustomEvent("lightsession-config", {
        detail: JSON.stringify(value)
      }));
    },
    runFetchWatch() {
      intervalCallback?.();
    },
    requestCachedConversation(conversationId = "test-id") {
      eventTarget.dispatchEvent(new CustomEvent(
        "chatgpt-tools-request-conversation",
        {
          detail: JSON.stringify({
            requestId: "test-request",
            conversationId
          })
        }
      ));
      return conversationResponses.at(-1) || null;
    },
    requestConversation(conversationId = "test-id") {
      const requestId = `request-${conversationResponses.length + 1}`;
      return new Promise((resolve) => {
        const handleResponse = (event) => {
          const value = JSON.parse(event.detail);
          if (value.requestId !== requestId) {
            return;
          }
          eventTarget.removeEventListener(
            "chatgpt-tools-conversation",
            handleResponse
          );
          resolve(value);
        };
        eventTarget.addEventListener(
          "chatgpt-tools-conversation",
          handleResponse
        );
        eventTarget.dispatchEvent(new CustomEvent(
          "chatgpt-tools-request-conversation",
          {
            detail: JSON.stringify({ requestId, conversationId })
          }
        ));
      });
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
  assert.deepEqual(
    runtime.requestCachedConversation()?.payload.mapping,
    payload.mapping
  );
});

test("fetch protection survives a later ChatGPT fetch wrapper", async () => {
  const runtime = createPageRuntime(conversation());
  runtime.configure({ enabled: true, limit: 2, debug: false });

  const protectedFetch = runtime.context.fetch;
  runtime.context.fetch = function chatGptFetch(...args) {
    return protectedFetch(...args);
  };
  runtime.runFetchWatch();

  const response = await runtime.context.fetch(
    "https://chatgpt.com/backend-api/conversation/test-id"
  );
  const result = await response.json();

  assert.equal(runtime.fetchCalls, 1);
  assert.deepEqual(Object.keys(result.mapping), ["n0", "n3", "n4"]);
  assert.equal(runtime.statuses.length, 1);
});

test("latest trimming status is replayed when content settings reconnect", async () => {
  const runtime = createPageRuntime(conversation());
  runtime.configure({ enabled: true, limit: 2, debug: false });
  await runtime.context.fetch(
    "https://chatgpt.com/backend-api/conversation/test-id"
  );

  runtime.configure({ enabled: true, limit: 2, debug: false });

  assert.equal(runtime.statuses.length, 2);
  assert.deepEqual(runtime.statuses[0], runtime.statuses[1]);
});

test("conversation bridge can refresh a full payload without trimming it", async () => {
  const payload = conversation();
  const runtime = createPageRuntime(payload);
  runtime.configure({ enabled: true, limit: 1, debug: false });

  const response = await runtime.requestConversation();

  assert.deepEqual(response.payload.mapping, payload.mapping);
  assert.equal(runtime.fetchCalls, 1);
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
