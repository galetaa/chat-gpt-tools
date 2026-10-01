"use strict";

(function installConversationDom(root, factory) {
  const api = factory();
  root.ChatGptToolsConversationDom = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function createConversationDom() {
  // Semantic markers from both the classic and September 2026 thread renderer.
  const USER_SELECTOR = '[data-chatgpt-search-unit-key$=":user"], [data-user-message-bubble], [data-message-author-role="user"], [data-markdown-text-tone="user-message"]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]';
  const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;
  const TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], article[data-turn-id], [data-virtualized-turn-content]';
  const CONTENT_SELECTOR = '[data-user-message-bubble], [data-markdown-text-tone="user-message"], [data-markdown-text-style="assistant-message"], .markdown, .whitespace-pre-wrap, [data-message-content]';
  const ATTRIBUTE_FILTER = ['data-chatgpt-search-unit-key', 'data-chatgpt-search-message-ids', 'data-user-message-bubble', 'data-message-author-role', 'data-message-id', 'data-testid', 'data-turn-id', 'data-virtualized-turn-content', 'data-markdown-text-tone', 'data-markdown-text-style', 'data-app-shell-active-page'];

  function roleOf(node) {
    if (node.matches(USER_SELECTOR)) return 'user';
    if (node.matches(ASSISTANT_SELECTOR)) return 'assistant';
    return null;
  }

  function collectMessages(document) {
    if (!document) return [];
    const nodes = Array.from(document.querySelectorAll(MESSAGE_SELECTOR)).filter((node) =>
      !node.closest('#chatgpt-tools-exporter, [data-app-shell-active-page="false"]')
    );
    const nodeSet = new Set(nodes);
    const messages = new Map();
    for (const node of nodes) {
      // A legacy role wrapper can contain the new Markdown markers as well.
      let parent = node.parentElement;
      let nested = false;
      while (parent) {
        if (nodeSet.has(parent)) { nested = true; break; }
        parent = parent.parentElement;
      }
      if (nested) continue;
      const role = roleOf(node);
      const turn = node.closest(TURN_SELECTOR);
      // A virtualized turn may contain BOTH the prompt and the response. Never
      // hide that entire turn when only one of its messages is outside the limit.
      const opposite = role === 'user' ? ASSISTANT_SELECTOR : USER_SELECTOR;
      const container = turn && !turn.matches(opposite) && !turn.querySelector(opposite)
        ? turn : node;
      let message = messages.get(container);
      if (!message) {
        message = { container, role, roleNode: node, contentNodes: [], id:
          node.getAttribute('data-message-id') || node.getAttribute('data-chatgpt-search-message-ids') || container.getAttribute('data-turn-id') || '' };
        messages.set(container, message);
      }
      const content = node.matches(CONTENT_SELECTOR) ? node : node.querySelector(CONTENT_SELECTOR) || node;
      if (!message.contentNodes.includes(content)) message.contentNodes.push(content);
    }
    return Array.from(messages.values());
  }

  function mutationMayChangeMessages(mutations) {
    const selector = `${TURN_SELECTOR}, ${MESSAGE_SELECTOR}`;
    return mutations.some((mutation) => mutation.type === 'attributes' ||
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))
      ));
  }

  return Object.freeze({ USER_SELECTOR, MESSAGE_SELECTOR, CONTENT_SELECTOR, ATTRIBUTE_FILTER, collectMessages, mutationMayChangeMessages });
});
