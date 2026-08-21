"use strict";

(function installDomTrimmer(root, factory) {
  const api = factory(root);
  root.ChatGptToolsDomTrimmer = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createDomTrimmer(root) {
  const TRIMMED_ATTRIBUTE = "data-ct-dom-trimmed";
  const TURN_SELECTOR = [
    '[data-testid^="conversation-turn-"]',
    "article[data-turn-id]"
  ].join(",");
  const MESSAGE_SELECTOR = [
    '[data-message-author-role="user"]',
    '[data-message-author-role="assistant"]'
  ].join(",");
  const APPLY_DELAY_MS = 120;

  function clampLimit(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 10;
  }

  function retainedStart(total, requestedLimit) {
    const count = Math.max(0, Number.parseInt(String(total), 10) || 0);
    return Math.max(0, count - clampLimit(requestedLimit));
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
      return Array.from(new Set(root.document.querySelectorAll(TURN_SELECTOR)))
        .filter((turn) => turn.matches(MESSAGE_SELECTOR) || turn.querySelector(MESSAGE_SELECTOR));
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
      if (!turns.length) {
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

    function mutationMayChangeTurns(mutations) {
      for (const mutation of mutations) {
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
          if (node.nodeType !== 1) {
            continue;
          }
          if (node.matches?.(TURN_SELECTOR) || node.querySelector?.(TURN_SELECTOR)) {
            return true;
          }
        }
      }
      return false;
    }

    function attach() {
      if (!enabled || observer || !root.document?.body) {
        return;
      }
      observer = new root.MutationObserver((mutations) => {
        if (mutationMayChangeTurns(mutations)) {
          schedule();
        }
      });
      observer.observe(root.document.body, { childList: true, subtree: true });
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

  return Object.freeze({ clampLimit, retainedStart, createController });
});
