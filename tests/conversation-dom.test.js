"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const dom = require('../Extension/content/conversation-dom.js');

// Small semantic DOM fixture: selectors are evaluated against attributes rather
// than returning a fixed list, so old selectors cannot pass the new-layout cases.
function element(attributes = {}, children = []) {
  const node = {
    nodeType: 1, parentElement: null, children,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => { delete attributes[name]; },
    matches(selector) {
      return selector.split(',').some((part) => {
        part = part.trim();
        if (part.startsWith('#')) return attributes.id === part.slice(1);
        const match = part.match(/^(article)?\[([^\]^$=]+)([\^$]?=)?(?:"([^"]*)")?\]$/);
        if (!match || (match[1] && attributes.tag !== 'article')) return false;
        const [, , name, op, value] = match;
        return op === '$=' ? String(attributes[name] || '').endsWith(value) : op === '=' ? attributes[name] === value : op === '^='
          ? String(attributes[name] || '').startsWith(value) : name in attributes;
      });
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  children.forEach((child) => { child.parentElement = node; });
  return node;
}
const user = () => element({ 'data-markdown-text-tone': 'user-message' });
const assistant = () => element({ 'data-markdown-text-style': 'assistant-message' });

test('September renderer is exportable without legacy role or message ID attributes', () => {
  const prompt = user(), response = assistant();
  const page = element({}, [prompt, response]);
  const messages = dom.collectMessages(page);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(messages.map((m) => m.contentNodes), [[prompt], [response]]);
  assert.deepEqual(messages.map((m) => m.container), [prompt, response]);
});

test('mixed virtualized turn keeps prompt and response independently trimmable', () => {
  const prompt = user(), response = assistant();
  const turn = element({ 'data-virtualized-turn-content': '' }, [prompt, response]);
  assert.deepEqual(dom.collectMessages(element({}, [turn])).map((m) => m.container), [prompt, response]);
});

test('multiple response blocks in one single-role turn export together and count once', () => {
  const first = assistant(), second = assistant();
  const turn = element({ 'data-virtualized-turn-content': '' }, [first, second]);
  const messages = dom.collectMessages(element({}, [turn]));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].container, turn);
  assert.deepEqual(messages[0].contentNodes, [first, second]);
});

test('classic exact conversation-turn and nested Markdown do not duplicate a message', () => {
  const content = user();
  const role = element({ 'data-message-author-role': 'user', 'data-message-id': 'prompt-1' }, [content]);
  const turn = element({ 'data-testid': 'conversation-turn' }, [role]);
  const messages = dom.collectMessages(element({}, [turn]));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].container, turn);
  assert.equal(messages[0].id, 'prompt-1');
  assert.deepEqual(messages[0].contentNodes, [content]);
});

test('inactive cached pages and exporter previews are excluded', () => {
  const current = assistant();
  const page = element({}, [
    element({ 'data-app-shell-active-page': 'false' }, [user()]),
    element({ id: 'chatgpt-tools-exporter' }, [assistant()]),
    current
  ]);
  assert.deepEqual(dom.collectMessages(page).map((m) => m.container), [current]);
});

test('late mounted content and semantic attribute changes trigger trimming; text streaming does not', () => {
  assert.equal(dom.mutationMayChangeMessages([{type: 'childList', addedNodes: [assistant()], removedNodes: []}]), true);
  assert.equal(dom.mutationMayChangeMessages([{type: 'attributes'}]), true);
  assert.equal(dom.mutationMayChangeMessages([{type: 'childList', addedNodes: [{nodeType: 3}], removedNodes: []}]), false);
});

test('DOM exporter preserves text from new messages, including trimmed messages', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const prompt = element({ 'data-markdown-text-tone': 'user-message', 'data-ct-dom-trimmed': 'true' }), response = assistant();
  for (const [node, text] of [[prompt, 'Test prompt'], [response, 'Test response']]) {
    node.tagName = 'DIV';
    node.classList = { contains: () => false };
    node.childNodes = [{ nodeType: 3, nodeValue: text }];
  }
  const document = element({}, [prompt, response]);
  document.title = 'Compatibility fixture';
  const context = vm.createContext({
    ChatGptToolsConversationDom: dom,
    document,
    location: new URL('https://chatgpt.com/c/fixture'),
    CSS: { escape: (value) => value },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    URL, console, addEventListener() {}
  });
  vm.runInContext(fs.readFileSync(require.resolve('../Extension/content/exporter-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../Extension/content/exporter.js'), 'utf8'), context);
  const result = context.ChatGptToolsExporter.extractConversationFromDom();
  assert.equal(result.source, 'visible-page');
  assert.deepEqual(Array.from(result.messages, (message) => message.markdown), ['Test prompt', 'Test response']);
  assert.deepEqual(Array.from(result.messages, (message) => message.role), ['user', 'assistant']);
});

test('plain user bubbles without Markdown markers count alongside model responses', () => {
  const bubble = element({ 'data-user-message-bubble': 'true' });
  const wrapper = element({
    'data-chatgpt-search-unit-key': 'fallback-turn-0:0:user',
    'data-chatgpt-search-message-ids': 'user-1'
  }, [bubble]);
  const response = assistant();
  const page = element({}, [wrapper, response]);
  const messages = dom.collectMessages(page);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[0].id, 'user-1');
  assert.deepEqual(messages[0].contentNodes, [bubble]);
  assert.equal(messages[0].container, wrapper);
  assert.equal(dom.collectMessages(element({}, [element({ 'data-user-message-bubble': 'true' })])).length, 1);
});

test('new plain prompt participates in trimming, stats, restore and export', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const nodes = [
    element({ 'data-user-message-bubble': 'true' }), assistant(),
    element({ 'data-user-message-bubble': 'true' }), assistant()
  ];
  nodes.forEach((node, index) => {
    node.tagName = 'DIV';
    node.classList = { contains: () => false };
    node.childNodes = [{ nodeType: 3, nodeValue: `Message ${index + 1}` }];
  });
  const document = element({}, nodes);
  document.body = document;
  document.title = 'Both roles';
  let pending;
  const stats = [];
  const context = vm.createContext({
    document, ChatGptToolsConversationDom: dom,
    location: new URL('https://chatgpt.com/c/fixture'),
    CSS: { escape: (value) => value }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    URL, console, addEventListener() {},
    setTimeout: (callback) => { pending = callback; return 1; }, clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} }
  });
  for (const file of ['dom-trimmer', 'exporter-core', 'exporter']) {
    vm.runInContext(fs.readFileSync(require.resolve(`../Extension/content/${file}.js`), 'utf8'), context);
  }
  const controller = context.ChatGptToolsDomTrimmer.createController({ onStats: (value) => stats.push(value) });
  controller.enable(3);
  pending();
  assert.deepEqual(nodes.map((n) => n.getAttribute('data-ct-dom-trimmed')), ['true', null, null, null]);
  assert.equal(stats.at(-1).totalBefore, 4);
  assert.equal(stats.at(-1).keptAfter, 3);
  const exported = context.ChatGptToolsExporter.extractConversationFromDom();
  assert.deepEqual(Array.from(exported.messages, (m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual(Array.from(exported.messages, (m) => m.markdown), ['Message 1', 'Message 2', 'Message 3', 'Message 4']);
  controller.setLimit(1);
  pending();
  assert.deepEqual(nodes.map((n) => n.getAttribute('data-ct-dom-trimmed')), ['true', 'true', 'true', null]);
  controller.teardown();
  assert.ok(nodes.every((n) => n.getAttribute('data-ct-dom-trimmed') === null));
});
