"use strict";

(function installDomTrimmer(root, factory) {
  const api = factory(root);
  root.ChatGptToolsDomTrimmer = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createDomTrimmer(root) {
  const TRIMMED_ATTRIBUTE = "data-ct-dom-trimmed";
  const dom = root.ChatGptToolsConversationDom ||
    (typeof require === "function" ? require("./conversation-dom.js") : null);
  const APPLY_DELAY_MS = 120;

  function clampLimit(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 10;
  }

  function retainedStart(total, requestedLimit) {
    const count = Math.max(0, Number.parseInt(String(total), 10) || 0);
    return Math.max(0, count - clampLimit(requestedLimit));
  }

  function mergeNetworkAndDomStats(networkStats, domStats) {
    const hiddenBeforeDom = Number.isFinite(networkStats?.removed)
      ? Math.max(0, networkStats.removed)
      : 0;

    return {
      totalBefore: domStats.totalBefore + hiddenBeforeDom,
      keptAfter: domStats.keptAfter,
      removed: domStats.removed + hiddenBeforeDom,
      limit: domStats.limit
    };
  }

  function createController({ onStats } = {}) {
    let enabled = false;
    let limit = 10;
    let observer = null;
    let timer = null;
    let lastStatsKey = "";

    function collectTurns() {
      if (!root.document) {
        return [];
      }
      return dom.collectMessages(root.document).map((message) => message.container);
    }

    function clearTrimmedTurns() {
      if (!root.document) {
        return;
      }
      for (const turn of root.document.querySelectorAll(`[${TRIMMED_ATTRIBUTE}]`)) {
        turn.removeAttribute(TRIMMED_ATTRIBUTE);
      }
      lastStatsKey = "";
    }

    function apply() {
      timer = null;
      if (!enabled) {
        return;
      }
      const turns = collectTurns();
      const currentTurns = new Set(turns);
      for (const previous of root.document.querySelectorAll(`[${TRIMMED_ATTRIBUTE}]`)) {
        if (!currentTurns.has(previous)) previous.removeAttribute(TRIMMED_ATTRIBUTE);
      }
      if (!turns.length) {
        lastStatsKey = "";
        return;
      }
      const start = retainedStart(turns.length, limit);
      for (const [index, turn] of turns.entries()) {
        if (index < start) {
          turn.setAttribute(TRIMMED_ATTRIBUTE, "true");
        } else {
          turn.removeAttribute(TRIMMED_ATTRIBUTE);
        }
      }
      const stats = {
        totalBefore: turns.length,
        keptAfter: turns.length - start,
        removed: start,
        limit
      };
      const statsKey = JSON.stringify(stats);
      if (statsKey !== lastStatsKey) {
        lastStatsKey = statsKey;
        onStats?.(stats);
      }
    }

    function schedule() {
      if (!enabled || timer !== null) {
        return;
      }
      timer = root.setTimeout(apply, APPLY_DELAY_MS);
    }

    function attach() {
      if (!enabled || observer || !root.document?.body) {
        return;
      }
      observer = new root.MutationObserver((mutations) => {
        if (dom.mutationMayChangeMessages(mutations)) {
          schedule();
        }
      });
      observer.observe(root.document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: dom.ATTRIBUTE_FILTER
      });
      schedule();
    }

    function enable(nextLimit) {
      enabled = true;
      limit = clampLimit(nextLimit);
      if (root.document?.body) {
        attach();
        schedule();
      } else {
        root.document?.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    }

    function setLimit(nextLimit) {
      limit = clampLimit(nextLimit);
      lastStatsKey = "";
      schedule();
    }

    function teardown() {
      enabled = false;
      observer?.disconnect();
      observer = null;
      if (timer !== null) {
        root.clearTimeout(timer);
        timer = null;
      }
      clearTrimmedTurns();
    }

    return Object.freeze({ attach, enable, setLimit, teardown });
  }

  return Object.freeze({
    clampLimit,
    retainedStart,
    mergeNetworkAndDomStats,
    createController
  });
});
