"use strict";

(function startContentScript() {
  const shared = globalThis.ChatGptToolsShared;
  const statusBar = globalThis.ChatGptToolsStatusBar;
  const domTrimmerFactory = globalThis.ChatGptToolsDomTrimmer;
  const collapseFactory = globalThis.ChatGptToolsUserMessageCollapse;
  const exporter = globalThis.ChatGptToolsExporter;

  if (!shared || !statusBar || !domTrimmerFactory || !collapseFactory || !exporter) {
    console.error("[ChatGPT Tools] Content script dependencies did not load");
    return;
  }

  const CONFIG_EVENT = "chatgpt-tools-config";
  const STATUS_EVENT = "chatgpt-tools-status";
  const READY_MESSAGE = "chatgpt-tools-proxy-ready";
  const REQUEST_CONFIG_EVENT = "chatgpt-tools-request-config";
  const NAVIGATION_EVENT = "chatgpt-tools-navigation";

  let settings = shared.DEFAULT_SETTINGS;
  let collapseController = null;
  let domTrimController = null;
  let currentUrl = location.href;
  let debugEnabled = false;
  let networkStatsReceived = false;

  function debug(...values) {
    if (debugEnabled) {
      console.debug("[ChatGPT Tools:Content]", ...values);
    }
  }

  function configPayload(value) {
    return JSON.stringify({
      enabled: value.enabled,
      limit: value.keep,
      debug: value.debug
    });
  }

  function dispatchConfig() {
    globalThis.dispatchEvent(new CustomEvent(CONFIG_EVENT, {
      detail: configPayload(settings)
    }));
  }

  function applySettings(nextSettings) {
    const previous = settings;
    settings = shared.normalizeSettings(nextSettings);
    debugEnabled = settings.debug;

    if (previous.enabled !== settings.enabled) {
      statusBar.reset();
    }

    dispatchConfig();
    statusBar.setVisible(settings.enabled && settings.showStatusBar);

    document.documentElement.classList.toggle("ls-ultra-lean", settings.ultraLean);

    if (settings.enabled) {
      if (!domTrimController) {
        domTrimController = domTrimmerFactory.createController({
          onStats: (stats) => {
            if (!networkStatsReceived) {
              statusBar.update(stats);
            }
          }
        });
        domTrimController.enable(settings.keep);
      } else {
        domTrimController.setLimit(settings.keep);
      }
    } else if (domTrimController) {
      domTrimController.teardown();
      domTrimController = null;
    }

    if (settings.enabled && settings.collapseLongUserMessages) {
      if (!collapseController) {
        collapseController = collapseFactory.createController();
      }
      collapseController.enable();
    } else if (collapseController) {
      collapseController.teardown();
      collapseController = null;
    }

    debug("Settings applied", settings);
  }

  function parseStatus(raw) {
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

    const fields = ["totalBefore", "keptAfter", "removed", "limit"];
    if (!fields.every((field) => Number.isFinite(candidate[field]))) {
      return null;
    }

    return {
      totalBefore: Math.max(0, candidate.totalBefore),
      keptAfter: Math.max(0, candidate.keptAfter),
      removed: Math.max(0, candidate.removed),
      limit: shared.clampInteger(
        candidate.limit,
        shared.MIN_KEEP,
        shared.MAX_KEEP,
        settings.keep
      )
    };
  }

  function handleStatus(event) {
    const parsed = parseStatus(event.detail);
    if (parsed) {
      networkStatsReceived = true;
      statusBar.update(parsed);
    } else {
      debug("Ignored malformed status payload", event.detail);
    }
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes[shared.SETTINGS_KEY]) {
      return;
    }

    applySettings(changes[shared.SETTINGS_KEY].newValue || shared.DEFAULT_SETTINGS);
  }

  function handleNavigation() {
    collapseController?.attach();

    if (location.href === currentUrl) {
      return;
    }

    currentUrl = location.href;
    networkStatsReceived = false;
    statusBar.reset();
    domTrimController?.attach();
    collapseController?.attach();
    debug("SPA navigation", currentUrl);
  }

  async function initialize() {
    globalThis.addEventListener(STATUS_EVENT, handleStatus);
    globalThis.addEventListener(REQUEST_CONFIG_EVENT, dispatchConfig);
    globalThis.addEventListener(NAVIGATION_EVENT, handleNavigation);
    globalThis.addEventListener("message", (event) => {
      if (event.source === globalThis && event.origin === location.origin) {
        if (event.data?.type === READY_MESSAGE) {
          dispatchConfig();
          debug("Page fetch interceptor is ready");
        }
      }
    });
    shared.api.storage.onChanged.addListener(handleStorageChange);
    shared.api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "chatgpt-tools:open-exporter") {
        return undefined;
      }
      exporter.open().catch((error) => {
        console.error("[ChatGPT Tools] Exporter failed to open", error);
      });
      sendResponse?.({ ok: true });
      return false;
    });

    settings = await shared.readSettings();
    applySettings(settings);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        statusBar.setVisible(settings.enabled && settings.showStatusBar);
        collapseController?.attach();
      }, { once: true });
    }

    debug("Content script initialized");
  }

  initialize().catch((error) => {
    console.error("[ChatGPT Tools] Content script failed to initialize", error);
  });
})();
