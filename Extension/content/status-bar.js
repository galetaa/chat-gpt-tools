"use strict";

(function installStatusBar(global) {
  const ELEMENT_ID = "chatgpt-tools-status-bar";
  const UPDATE_THROTTLE_MS = 500;

  let visible = false;
  let lastStats = null;
  let pendingStats = null;
  let lastPaintAt = 0;
  let timer = null;

  function createMetric(className, label) {
    const metric = document.createElement("span");
    metric.className = `ct-status-metric ${className}`;
    const value = document.createElement("strong");
    value.textContent = "0";
    const caption = document.createElement("span");
    caption.textContent = label;
    metric.append(value, caption);
    return metric;
  }

  function getElement() {
    let element = document.getElementById(ELEMENT_ID);
    if (element) {
      return element;
    }
    if (!document.body) {
      return null;
    }

    element = document.createElement("div");
    element.id = ELEMENT_ID;
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");

    const metrics = document.createElement("span");
    metrics.className = "ct-status-metrics";
    metrics.append(
      createMetric("ct-status-shown", "shown"),
      createMetric("ct-status-hidden", "hidden")
    );

    const waiting = document.createElement("span");
    waiting.className = "ct-status-waiting";
    waiting.textContent = "Waiting for conversation";

    element.append(metrics, waiting);
    document.body.appendChild(element);
    return element;
  }

  function paint(stats) {
    const element = getElement();
    if (!element || !visible) {
      return;
    }

    const waiting = stats.totalBefore === 0;
    const shown = Math.max(0, stats.keptAfter);
    const hidden = Math.max(0, stats.removed);
    element.dataset.state = waiting ? "waiting" : hidden > 0 ? "trimmed" : "complete";
    element.querySelector(".ct-status-shown strong").textContent = String(shown);
    element.querySelector(".ct-status-hidden strong").textContent = String(hidden);
    element.setAttribute(
      "aria-label",
      waiting
        ? "ChatGPT Tools is waiting for a conversation"
        : `ChatGPT Tools. ${shown} messages shown. ${hidden} messages hidden.`
    );
    element.hidden = false;
    lastPaintAt = performance.now();
  }

  function statsAreEqual(left, right) {
    return Boolean(
      left &&
      right &&
      left.totalBefore === right.totalBefore &&
      left.keptAfter === right.keptAfter &&
      left.removed === right.removed &&
      left.limit === right.limit
    );
  }

  function update(stats) {
    if (statsAreEqual(lastStats, stats)) {
      return;
    }
    lastStats = stats;
    if (!visible) {
      return;
    }

    const elapsed = performance.now() - lastPaintAt;
    if (elapsed >= UPDATE_THROTTLE_MS) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingStats = null;
      paint(stats);
      return;
    }

    pendingStats = stats;
    if (timer === null) {
      timer = global.setTimeout(() => {
        timer = null;
        if (pendingStats && visible) {
          paint(pendingStats);
        }
        pendingStats = null;
      }, UPDATE_THROTTLE_MS - elapsed);
    }
  }

  function reset() {
    lastStats = null;
    pendingStats = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (visible) {
      paint({ totalBefore: 0, keptAfter: 0, removed: 0, limit: 0 });
    }
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    const element = getElement();
    if (!element) {
      return;
    }
    element.hidden = !visible;
    if (visible) {
      if (lastStats) {
        paint(lastStats);
      } else {
        reset();
      }
    }
  }

  global.ChatGptToolsStatusBar = Object.freeze({ update, reset, setVisible });
})(globalThis);
