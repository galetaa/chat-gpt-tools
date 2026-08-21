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
  const CONFIG_WAIT_MS = 1500;
  const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  const defaultConfig = Object.freeze({
    enabled: true,
    limit: 10,
    debug: false
  });

  let config = defaultConfig;
  let configReceived = false;
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
    globalThis.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: JSON.stringify(stats)
    }));
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
    const details = requestDetails(args[0], args[1]);
    if (!isConversationRequest(details)) {
      return Reflect.apply(originalFetch, thisValue, args);
    }

    await waitForInitialConfig();
    if (!config.enabled) {
      return Reflect.apply(originalFetch, thisValue, args);
    }

    const response = await Reflect.apply(originalFetch, thisValue, args);
    if (!isJsonResponse(response)) {
      return response;
    }

    try {
      const payload = await response.clone().json();
      const trimmed = core.trimConversation(payload, config.limit);
      if (!trimmed) {
        debug("Response did not match the expected conversation shape");
        return response;
      }

      emitStatus(trimmed.stats);

      if (!trimmed.changed) {
        debug("No trimming required", trimmed.stats);
        return response;
      }

      debug("Conversation trimmed", trimmed.stats);
      return rebuildJsonResponse(response, trimmed.conversation);
    } catch (error) {
      debug("Failed to inspect conversation response", error);
      return response;
    }
  }

  globalThis.addEventListener(CONFIG_EVENT, (event) => {
    acceptConfig(event.detail);
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function lightSessionFetch(...args) {
    return interceptFetch(originalFetch, this, args);
  };

  Object.defineProperty(globalThis, patchFlag, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  installNavigationBridge();
  globalThis.postMessage({ type: READY_MESSAGE }, location.origin);
  globalThis.dispatchEvent(new CustomEvent(REQUEST_CONFIG_EVENT));
  debug("Fetch interceptor installed");
})();
