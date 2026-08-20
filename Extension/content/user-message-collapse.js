"use strict";

(function installUserMessageCollapse(global) {
  const MESSAGE_SELECTOR = '[data-message-author-role="user"][data-message-id]';
  const BUBBLE_SELECTOR = ".user-message-bubble-color";
  const TEXT_SELECTORS = [
    ".whitespace-pre-wrap",
    ".markdown.prose",
    ".markdown",
    ".prose"
  ];
  const PROCESSED_ATTRIBUTE = "data-ls-uc-processed";
  const STATE_ATTRIBUTE = "data-ls-uc-state";
  const COLLAPSE_HEIGHT_PX = 240;
  const BOTTOM_TOLERANCE_PX = 120;

  function findTextContainer(bubble) {
    for (const selector of TEXT_SELECTORS) {
      const candidate = bubble.querySelector(selector);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  function safeId(value) {
    const result = String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
    return result || "message";
  }

  function findConversationRoot() {
    const main = document.querySelector("main");
    if (!main) {
      return null;
    }

    const firstTurn = main.querySelector('[data-testid="conversation-turn"]');
    if (firstTurn?.parentElement) {
      return firstTurn.parentElement;
    }

    return main.querySelector('[data-testid="conversation-turns"]') || main;
  }

  function findScrollContainer(start) {
    let element = start;
    while (element && element !== document.body && element !== document.documentElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight + 1
      ) {
        return element;
      }
      element = element.parentElement;
    }

    const scrollingElement = document.scrollingElement;
    return scrollingElement instanceof HTMLElement
      ? scrollingElement
      : document.documentElement;
  }

  function isNearBottom(element) {
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      BOTTOM_TOLERANCE_PX
    );
  }

  function restoreScroll(element, previousTop, previousHeight, wasNearBottom) {
    const nextHeight = element.scrollHeight;
    if (wasNearBottom) {
      element.scrollTop = Math.max(0, nextHeight - element.clientHeight);
      return;
    }

    element.scrollTop = previousTop + (nextHeight - previousHeight);
  }

  function setButtonLabel(button, expanded) {
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.textContent = expanded ? "Show less" : "Show more";
  }

  function getOrCreateButton(bubble, textId) {
    let button = bubble.querySelector("button.ls-uc-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "ls-uc-toggle";
      bubble.appendChild(button);
    }
    button.setAttribute("aria-controls", textId);
    return button;
  }

  function cleanupMessage(message, bubble, text) {
    bubble.removeAttribute(STATE_ATTRIBUTE);
    bubble.classList.remove("ls-uc-bubble");
    bubble.querySelector("button.ls-uc-toggle")?.remove();
    text.classList.remove("ls-uc-text");
    text.style.removeProperty("--ls-uc-fade-to");
    message.removeAttribute(PROCESSED_ATTRIBUTE);
  }

  function processMessage(message) {
    const bubble = message.querySelector(BUBBLE_SELECTOR);
    if (!bubble) {
      return;
    }

    const text = findTextContainer(bubble);
    if (!text) {
      return;
    }

    const isLong = text.scrollHeight > COLLAPSE_HEIGHT_PX + 24;
    const alreadyProcessed = message.hasAttribute(PROCESSED_ATTRIBUTE);
    if (!isLong) {
      if (alreadyProcessed || bubble.querySelector("button.ls-uc-toggle")) {
        cleanupMessage(message, bubble, text);
      }
      return;
    }

    message.setAttribute(PROCESSED_ATTRIBUTE, "1");
    bubble.classList.add("ls-uc-bubble");
    text.classList.add("ls-uc-text");

    const backgroundColor = getComputedStyle(bubble).backgroundColor;
    if (backgroundColor) {
      text.style.setProperty("--ls-uc-fade-to", backgroundColor);
    }

    const messageId = message.getAttribute("data-message-id") || "message";
    if (!text.id) {
      text.id = `ls-uc-text-${safeId(messageId)}`;
    }

    if (!bubble.hasAttribute(STATE_ATTRIBUTE)) {
      bubble.setAttribute(STATE_ATTRIBUTE, "collapsed");
    }

    const button = getOrCreateButton(bubble, text.id);
    setButtonLabel(button, bubble.getAttribute(STATE_ATTRIBUTE) === "expanded");
  }

  function messagesFromNode(node) {
    if (!(node instanceof HTMLElement)) {
      return [];
    }

    const messages = new Set();
    if (node.matches(MESSAGE_SELECTOR)) {
      messages.add(node);
    }

    const closest = node.closest(MESSAGE_SELECTOR);
    if (closest) {
      messages.add(closest);
    }

    node.querySelectorAll(MESSAGE_SELECTOR).forEach((message) => messages.add(message));
    return Array.from(messages);
  }

  function createController() {
    let enabled = false;
    let observedRoot = null;
    let scrollContainer = null;
    let rootObserver = null;
    let discoveryObserver = null;
    let framePending = false;
    const pendingMessages = new Set();

    function queueMessage(message) {
      pendingMessages.add(message);
      if (framePending) {
        return;
      }

      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        if (!enabled) {
          pendingMessages.clear();
          return;
        }

        const keepBottom = scrollContainer ? isNearBottom(scrollContainer) : false;
        pendingMessages.forEach((candidate) => {
          if (candidate.isConnected) {
            processMessage(candidate);
          }
        });
        pendingMessages.clear();

        if (scrollContainer && keepBottom) {
          scrollContainer.scrollTop = Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight
          );
        }
      });
    }

    function queueFromMutation(mutation) {
      if (mutation.type === "characterData") {
        const parent = mutation.target.parentElement;
        if (parent) {
          messagesFromNode(parent).forEach(queueMessage);
        }
        return;
      }

      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          messagesFromNode(node).forEach(queueMessage);
        });
        if (mutation.target instanceof HTMLElement) {
          messagesFromNode(mutation.target).forEach(queueMessage);
        }
      } else if (mutation.target instanceof HTMLElement) {
        messagesFromNode(mutation.target).forEach(queueMessage);
      }
    }

    function observeRoot(root) {
      rootObserver?.disconnect();
      observedRoot = root;
      scrollContainer = findScrollContainer(root);
      rootObserver = new MutationObserver((mutations) => {
        mutations.forEach(queueFromMutation);
      });
      rootObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["data-message-author-role", "data-message-id"]
      });

      root.querySelectorAll(MESSAGE_SELECTOR).forEach(queueMessage);
    }

    function attach() {
      if (!enabled) {
        return;
      }

      const nextRoot = findConversationRoot();
      if (!nextRoot) {
        if (!discoveryObserver) {
          discoveryObserver = new MutationObserver(() => attach());
          discoveryObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
          });
        }
        return;
      }

      discoveryObserver?.disconnect();
      discoveryObserver = null;

      if (nextRoot !== observedRoot || !observedRoot?.isConnected) {
        observeRoot(nextRoot);
      }
    }

    function handleClick(event) {
      if (!enabled || !(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest("button.ls-uc-toggle");
      const bubble = button?.closest(".ls-uc-bubble");
      if (!button || !bubble || !scrollContainer) {
        return;
      }

      const previousTop = scrollContainer.scrollTop;
      const previousHeight = scrollContainer.scrollHeight;
      const wasNearBottom = isNearBottom(scrollContainer);
      const wasExpanded = bubble.getAttribute(STATE_ATTRIBUTE) === "expanded";

      bubble.setAttribute(STATE_ATTRIBUTE, wasExpanded ? "collapsed" : "expanded");
      setButtonLabel(button, !wasExpanded);

      requestAnimationFrame(() => {
        if (scrollContainer) {
          restoreScroll(
            scrollContainer,
            previousTop,
            previousHeight,
            wasNearBottom
          );
        }
      });
    }

    function enable() {
      if (!enabled) {
        enabled = true;
        document.addEventListener("click", handleClick, true);
      }
      attach();
    }

    function teardown() {
      enabled = false;
      document.removeEventListener("click", handleClick, true);
      rootObserver?.disconnect();
      discoveryObserver?.disconnect();
      rootObserver = null;
      discoveryObserver = null;
      observedRoot = null;
      scrollContainer = null;
      pendingMessages.clear();

      document.querySelectorAll(MESSAGE_SELECTOR).forEach((message) => {
        const bubble = message.querySelector(BUBBLE_SELECTOR);
        const text = bubble && findTextContainer(bubble);
        if (bubble && text) {
          cleanupMessage(message, bubble, text);
        }
      });
    }

    return Object.freeze({ enable, attach, teardown });
  }

  global.LightSessionUserMessageCollapse = Object.freeze({ createController });
})(globalThis);
