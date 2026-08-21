"use strict";

(function installFetchInterceptor() {
  const coreKey = "__LIGHT_SESSION_SAFARI_TRIM_CORE__";
  const core = globalThis[coreKey];
  const patchFlag = "__LIGHT_SESSION_SAFARI_FETCH_PATCHED__";

  if (!core || typeof core.trimConversation !== "function") {
    console.error("[ChatGPT Tools] Trimming core did not load");
    return;
  }

  try {
    delete globalThis[coreKey];
  } catch {
    // The temporary global is harmless if WebKit prevents deleting it.
  }

  if (globalThis[patchFlag] === true) {
    return;
  }

  const CONFIG_EVENT = "lightsession-config";
  const STATUS_EVENT = "lightsession-status";
  const READY_MESSAGE = "lightsession-proxy-ready";
  const REQUEST_CONFIG_EVENT = "lightsession-request-config";
  const NAVIGATION_EVENT = "lightsession-navigation";
  const CONVERSATION_REQUEST_EVENT = "chatgpt-tools-request-conversation";
  const CONVERSATION_RESPONSE_EVENT = "chatgpt-tools-conversation";
  const CONFIG_WAIT_MS = 1500;
  const FETCH_RECHECK_MS = 750;
  const CONVERSATION_CACHE_TTL_MS = 15000;
  const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const processedResponse = Symbol("chatgpt-tools-processed-response");
  const installedFetchWrappers = new WeakSet();

  const defaultConfig = Object.freeze({
    enabled: true,
    limit: 10,
    debug: false
  });

  let config = defaultConfig;
  let configReceived = false;
  let lastStats = null;
  let cachedConversation = null;
  let cachedConversationTimer = null;
  let fullFetchDepth = 0;
  let resolveConfig;
  const configReady = new Promise((resolve) => {
    resolveConfig = resolve;
  });

  function debug(...values) {
    if (config.debug) {
      console.debug("[ChatGPT Tools:Page]", ...values);
    }
  }

  function parseConfig(raw) {
    let candidate = raw;
    if (typeof raw === "string") {
      try {
        candidate = JSON.parse(raw);
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    return {
      enabled: typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : defaultConfig.enabled,
      limit: core.clampLimit(candidate.limit),
      debug: typeof candidate.debug === "boolean"
        ? candidate.debug
        : defaultConfig.debug
    };
  }

  function acceptConfig(raw) {
    const next = parseConfig(raw);
    if (!next) {
      return;
    }

    config = next;
    if (!configReceived) {
      configReceived = true;
      resolveConfig();
    }
    if (lastStats) {
      emitStatus(lastStats);
    }
    debug("Configuration updated", config);
  }

  async function waitForInitialConfig() {
    if (configReceived) {
      return;
    }

    await Promise.race([
      configReady,
      new Promise((resolve) => globalThis.setTimeout(resolve, CONFIG_WAIT_MS))
    ]);
  }

  function requestDetails(input, init) {
    try {
      let rawUrl;
      let method;

      if (input instanceof Request) {
        rawUrl = input.url;
        method = init?.method ?? input.method;
      } else if (input instanceof URL) {
        rawUrl = input.href;
        method = init?.method ?? "GET";
      } else {
        rawUrl = String(input);
        method = init?.method ?? "GET";
      }

      return {
        url: new URL(rawUrl, location.href),
        method: String(method).toUpperCase()
      };
    } catch {
      return null;
    }
  }

  function isConversationRequest(details) {
    if (!details || details.method !== "GET") {
      return false;
    }

    if (!ALLOWED_HOSTS.has(details.url.hostname)) {
      return false;
    }

    return /^\/backend-api\/(conversation|shared_conversation)\/[^/]+\/?$/.test(
      details.url.pathname
    );
  }

  function isJsonResponse(response) {
    return (response.headers.get("content-type") || "")
      .toLowerCase()
      .includes("application/json");
  }

  function rebuildJsonResponse(original, value) {
    const headers = new Headers(original.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "application/json; charset=utf-8");

    const replacement = new Response(JSON.stringify(value), {
      status: original.status,
      statusText: original.statusText,
      headers
    });

    try {
      if (original.url) {
        Object.defineProperty(replacement, "url", { value: original.url });
      }
      if (original.type) {
        Object.defineProperty(replacement, "type", { value: original.type });
      }
    } catch {
      // url/type are informational; the payload remains valid without overrides.
    }

    return replacement;
  }

  function emitStatus(stats) {
    lastStats = stats;
    globalThis.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: JSON.stringify(stats)
    }));
  }

  function markResponseProcessed(response) {
    try {
      Object.defineProperty(response, processedResponse, { value: true });
    } catch {
      // Nested wrappers may inspect the response twice; this is still safe.
    }
    return response;
  }

  function cacheConversationPayload(payload, details) {
    if (!payload?.mapping || !payload?.current_node) {
      return;
    }
    const pathParts = details.url.pathname.split("/").filter(Boolean);
    cachedConversation = {
      conversationId: pathParts[pathParts.length - 1] || "",
      payload
    };
    if (cachedConversationTimer !== null) {
      globalThis.clearTimeout(cachedConversationTimer);
    }
    cachedConversationTimer = globalThis.setTimeout(() => {
      cachedConversationTimer = null;
      cachedConversation = null;
    }, CONVERSATION_CACHE_TTL_MS);
    cachedConversationTimer?.unref?.();
  }

  function takeCachedConversation(conversationId) {
    if (!cachedConversation) {
      return null;
    }
    if (
      conversationId &&
      cachedConversation.conversationId &&
      conversationId !== cachedConversation.conversationId
    ) {
      return null;
    }
    const payload = cachedConversation.payload;
    cachedConversation = null;
    if (cachedConversationTimer !== null) {
      globalThis.clearTimeout(cachedConversationTimer);
      cachedConversationTimer = null;
    }
    return payload;
  }

  async function fetchFullConversationPayload(conversationId) {
    if (!conversationId) {
      return null;
    }
    fullFetchDepth += 1;
    try {
      const response = await globalThis.fetch(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
        {
          credentials: "include",
          headers: { Accept: "application/json" }
        }
      );
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      return payload?.mapping && payload?.current_node ? payload : null;
    } catch (error) {
      debug("Could not refresh the full conversation for export", error);
      return null;
    } finally {
      fullFetchDepth -= 1;
    }
  }

  function installConversationBridge() {
    globalThis.addEventListener(CONVERSATION_REQUEST_EVENT, async (event) => {
      let request;
      try {
        request = typeof event.detail === "string"
          ? JSON.parse(event.detail)
          : event.detail;
      } catch {
        return;
      }
      if (!request?.requestId) {
        return;
      }
      const payload = takeCachedConversation(request.conversationId) ||
        await fetchFullConversationPayload(request.conversationId);
      if (!payload) {
        return;
      }
      globalThis.dispatchEvent(new CustomEvent(CONVERSATION_RESPONSE_EVENT, {
        detail: JSON.stringify({
          requestId: request.requestId,
          payload
        })
      }));
    });
  }

  function installNavigationBridge() {
    const navigationPatchFlag = "__LIGHT_SESSION_SAFARI_HISTORY_PATCHED__";
    if (!globalThis.history || globalThis[navigationPatchFlag] === true) {
      return;
    }

    let previousUrl = location.href;
    const notifyIfChanged = () => {
      if (location.href === previousUrl) {
        return;
      }
      previousUrl = location.href;
      globalThis.dispatchEvent(new CustomEvent(NAVIGATION_EVENT));
    };

    globalThis.addEventListener("popstate", notifyIfChanged);
    globalThis.addEventListener("hashchange", notifyIfChanged);

    for (const methodName of ["pushState", "replaceState"]) {
      try {
        const original = globalThis.history[methodName];
        if (typeof original !== "function") {
          continue;
        }
        globalThis.history[methodName] = function lightSessionHistory(...args) {
          const result = Reflect.apply(original, this, args);
          notifyIfChanged();
          return result;
        };
      } catch (error) {
        debug(`Could not observe history.${methodName}`, error);
      }
    }

    Object.defineProperty(globalThis, navigationPatchFlag, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  }

  async function interceptFetch(originalFetch, thisValue, args) {
    if (fullFetchDepth > 0) {
      return Reflect.apply(originalFetch, thisValue, args);
    }
    const details = requestDetails(args[0], args[1]);
    if (!isConversationRequest(details)) {
      return Reflect.apply(originalFetch, thisValue, args);
    }

    const responsePromise = Reflect.apply(originalFetch, thisValue, args);
    await waitForInitialConfig();
    const response = await responsePromise;
    if (response?.[processedResponse]) {
      return response;
    }
    if (!isJsonResponse(response)) {
      return response;
    }

    try {
      const payload = await response.clone().json();
      cacheConversationPayload(payload, details);
      if (!config.enabled) {
        return markResponseProcessed(response);
      }
      const trimmed = core.trimConversation(payload, config.limit);
      if (!trimmed) {
        debug("Response did not match the expected conversation shape");
        return markResponseProcessed(response);
      }

      emitStatus(trimmed.stats);

      if (!trimmed.changed) {
        debug("No trimming required", trimmed.stats);
        return markResponseProcessed(response);
      }

      debug("Conversation trimmed", trimmed.stats);
      return markResponseProcessed(rebuildJsonResponse(response, trimmed.conversation));
    } catch (error) {
      debug("Failed to inspect conversation response", error);
      return markResponseProcessed(response);
    }
  }

  globalThis.addEventListener(CONFIG_EVENT, (event) => {
    acceptConfig(event.detail);
  });

  function installFetchWrapper() {
    const downstreamFetch = globalThis.fetch;
    if (
      typeof downstreamFetch !== "function" ||
      installedFetchWrappers.has(downstreamFetch)
    ) {
      return;
    }
    function chatGptToolsFetch(...args) {
      return interceptFetch(downstreamFetch, this, args);
    }
    installedFetchWrappers.add(chatGptToolsFetch);
    globalThis.fetch = chatGptToolsFetch;
  }

  installFetchWrapper();
  globalThis.setInterval(installFetchWrapper, FETCH_RECHECK_MS);

  Object.defineProperty(globalThis, patchFlag, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  installNavigationBridge();
  installConversationBridge();
  globalThis.postMessage({ type: READY_MESSAGE }, location.origin);
  globalThis.dispatchEvent(new CustomEvent(REQUEST_CONFIG_EVENT));
  debug("Fetch interceptor installed");
})();
