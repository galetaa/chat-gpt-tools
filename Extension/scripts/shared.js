"use strict";

(function installShared(global) {
  const api = typeof global.browser !== "undefined"
    ? global.browser
    : global.chrome;

  const SETTINGS_KEY = "ls_settings";
  const MIN_KEEP = 1;
  const STANDARD_MAX_KEEP = 20;
  const MAX_KEEP = 100;

  const DEFAULT_SETTINGS = Object.freeze({
    version: 2,
    enabled: true,
    keep: 10,
    extendedRange: false,
    showStatusBar: true,
    collapseLongUserMessages: true,
    debug: false,
    ultraLean: false
  });

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(minimum, Math.min(maximum, parsed));
  }

  function booleanOrDefault(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeSettings(input = {}) {
    const candidate = input && typeof input === "object" ? input : {};
    const candidateKeep = clampInteger(
      candidate.keep,
      MIN_KEEP,
      MAX_KEEP,
      DEFAULT_SETTINGS.keep
    );
    const extendedRange = typeof candidate.extendedRange === "boolean"
      ? candidate.extendedRange
      : candidateKeep > STANDARD_MAX_KEEP;

    return {
      version: 2,
      enabled: booleanOrDefault(candidate.enabled, DEFAULT_SETTINGS.enabled),
      keep: clampInteger(
        candidateKeep,
        MIN_KEEP,
        extendedRange ? MAX_KEEP : STANDARD_MAX_KEEP,
        DEFAULT_SETTINGS.keep
      ),
      extendedRange,
      showStatusBar: booleanOrDefault(
        candidate.showStatusBar,
        DEFAULT_SETTINGS.showStatusBar
      ),
      collapseLongUserMessages: booleanOrDefault(
        candidate.collapseLongUserMessages,
        DEFAULT_SETTINGS.collapseLongUserMessages
      ),
      debug: booleanOrDefault(candidate.debug, DEFAULT_SETTINGS.debug),
      ultraLean: booleanOrDefault(
        candidate.ultraLean,
        DEFAULT_SETTINGS.ultraLean
      )
    };
  }

  function settingsAreEqual(left, right) {
    return Boolean(
      right &&
      typeof right === "object" &&
      Object.keys(DEFAULT_SETTINGS).every((key) => left[key] === right[key])
    );
  }

  async function readSettings({ persistNormalized = true } = {}) {
    if (!api?.storage?.local) {
      throw new Error("Extension storage API is unavailable");
    }

    const result = await api.storage.local.get(SETTINGS_KEY);
    const stored = result?.[SETTINGS_KEY];
    const normalized = normalizeSettings(stored);

    if (
      persistNormalized &&
      !settingsAreEqual(normalized, stored)
    ) {
      await api.storage.local.set({ [SETTINGS_KEY]: normalized });
    }

    return normalized;
  }

  async function writeSettings(patch) {
    const current = await readSettings({ persistNormalized: false });
    const next = normalizeSettings({ ...current, ...patch });
    await api.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function isSupportedUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return false;
    }

    try {
      const url = new URL(rawUrl);
      return (
        url.protocol === "https:" &&
        (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")
      );
    } catch {
      return false;
    }
  }

  global.ChatGptToolsShared = Object.freeze({
    api,
    SETTINGS_KEY,
    MIN_KEEP,
    STANDARD_MAX_KEEP,
    MAX_KEEP,
    DEFAULT_SETTINGS,
    clampInteger,
    normalizeSettings,
    readSettings,
    writeSettings,
    isSupportedUrl
  });
})(globalThis);
