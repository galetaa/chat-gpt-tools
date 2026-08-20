"use strict";

(function installStatusBar(global) {
  const ELEMENT_ID = "lightsession-status-bar";
  const WAITING_TEXT = "LightSession · waiting for messages…";
  const UPDATE_THROTTLE_MS = 500;

  let visible = false;
  let lastStats = null;
  let pendingStats = null;
  let lastPaintAt = 0;
  let timer = null;

  function styleElement(element) {
    Object.assign(element.style, {
      position: "fixed",
      bottom: "3.5px",
      right: "24px",
      zIndex: "10000",
      padding: "4px 10px",
      fontSize: "11px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontWeight: "500",
      color: "#e5e7eb",
      backgroundColor: "rgba(15, 23, 42, 0.9)",
      border: "1px solid rgba(55, 65, 81, 0.9)",
      borderRadius: "9999px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
      backdropFilter: "blur(4px)",
      webkitBackdropFilter: "blur(4px)",
      maxWidth: "60%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      pointerEvents: "none",
      transition: "opacity 0.2s ease"
    });
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
    styleElement(element);
    document.body.appendChild(element);
    return element;
  }

  function presentationFor(stats) {
    if (stats.removed > 0) {
      return {
        text: `LightSession · last ${stats.limit} · ${stats.removed} trimmed`,
        state: "active"
      };
    }

    if (stats.totalBefore === 0) {
      return { text: WAITING_TEXT, state: "waiting" };
    }

    return {
      text: `LightSession · all ${stats.totalBefore} visible`,
      state: "all-visible"
    };
  }

  function applyState(element, state) {
    element.style.opacity = "1";
    element.style.color = "#e5e7eb";
    element.style.backgroundColor = "rgba(15, 23, 42, 0.9)";
    element.style.borderColor = "rgba(55, 65, 81, 0.9)";

    if (state === "active") {
      element.style.color = "#6ee7b7";
      element.style.backgroundColor = "rgba(6, 78, 59, 0.9)";
      element.style.borderColor = "rgba(16, 185, 129, 0.5)";
    } else if (state === "waiting") {
      element.style.color = "#9ca3af";
    }
  }

  function paint(stats) {
    const element = getElement();
    if (!element || !visible) {
      return;
    }

    const presentation = presentationFor(stats);
    element.textContent = presentation.text;
    element.style.display = "block";
    applyState(element, presentation.state);
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

    if (!visible) {
      return;
    }

    const element = getElement();
    if (!element) {
      return;
    }
    element.textContent = WAITING_TEXT;
    element.style.display = "block";
    applyState(element, "waiting");
    lastPaintAt = performance.now();
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    const element = getElement();
    if (!element) {
      return;
    }

    if (!visible) {
      element.style.display = "none";
      return;
    }

    element.style.display = "block";
    if (lastStats) {
      paint(lastStats);
    } else {
      reset();
    }
  }

  global.LightSessionStatusBar = Object.freeze({
    update,
    reset,
    setVisible
  });
})(globalThis);
