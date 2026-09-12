"use strict";

(function installConversationExporter(global) {
  const core = global.ChatGptToolsExporterCore;
  if (!core) {
    console.error("[ChatGPT Tools] Exporter core did not load");
    return;
  }

  const ROOT_ID = "chatgpt-tools-exporter";
  const PRINT_JOB_PREFIX = "ct_print_job_";
  const CONVERSATION_REQUEST_EVENT = "chatgpt-tools-request-conversation";
  const CONVERSATION_RESPONSE_EVENT = "chatgpt-tools-conversation";
  const CONVERSATION_BRIDGE_TIMEOUT_MS = 6000;
  const SKIPPED_TAGS = new Set([
    "BUTTON", "SCRIPT", "STYLE", "TEMPLATE", "FORM", "TEXTAREA", "SVG",
    "PATH", "NOSCRIPT"
  ]);

  let root = null;
  let settings = core.DEFAULT_SETTINGS;
  let conversation = null;
  let selectedIds = new Set();
  let lastSelectedIndex = null;
  let loading = false;
  let resizeState = null;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function inlineMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIPPED_TAGS.has(node.tagName)) {
      return "";
    }

    const tag = node.tagName;
    if (tag === "BR") {
      return "\n";
    }
    if (node.matches("[data-ls-uc-control], [aria-hidden='true']")) {
      return "";
    }
    if (node.classList.contains("katex")) {
      const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent;
      if (tex) {
        return `$${tex}$`;
      }
    }

    const children = Array.from(node.childNodes).map(inlineMarkdown).join("");
    if (!children.trim() && tag !== "IMG") {
      return "";
    }
    if (["STRONG", "B"].includes(tag)) {
      return `**${children.trim()}**`;
    }
    if (["EM", "I"].includes(tag)) {
      return `*${children.trim()}*`;
    }
    if (tag === "DEL" || tag === "S") {
      return `~~${children.trim()}~~`;
    }
    if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
      return `\`${children.trim()}\``;
    }
    if (tag === "A") {
      const href = safeHttpUrl(node.getAttribute("href"));
      return href ? `[${children.trim() || href}](${href})` : children;
    }
    if (tag === "IMG") {
      const src = safeHttpUrl(node.getAttribute("src"));
      const alt = node.getAttribute("alt") || "Image";
      return src ? `![${alt}](${src})` : `[${alt}]`;
    }
    return children;
  }

  function blockMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIPPED_TAGS.has(node.tagName)) {
      return "";
    }
    if (node.matches("[data-ls-uc-control], [aria-hidden='true']")) {
      return "";
    }

    const tag = node.tagName;
    if (tag === "PRE") {
      const code = node.textContent?.trim() || "";
      const languageClass = node.querySelector("code")?.className.match(/language-([\w-]+)/);
      return `\n\n\`\`\`${languageClass?.[1] || ""}\n${code}\n\`\`\`\n\n`;
    }
    if (/^H[1-6]$/.test(tag)) {
      const level = Number.parseInt(tag.slice(1), 10);
      return `\n\n${"#".repeat(level)} ${inlineMarkdown(node).trim()}\n\n`;
    }
    if (tag === "P") {
      return `\n\n${inlineMarkdown(node).trim()}\n\n`;
    }
    if (tag === "BLOCKQUOTE") {
      const value = Array.from(node.childNodes).map((child) => blockMarkdown(child, depth + 1)).join("");
      return `\n\n${core.normalizeNewlines(value).split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "LI") {
      const ordered = node.parentElement?.tagName === "OL";
      const index = ordered
        ? Array.from(node.parentElement.children).indexOf(node) + 1
        : null;
      const marker = ordered ? `${index}.` : "-";
      return `\n${"  ".repeat(depth)}${marker} ${inlineMarkdown(node).trim()}`;
    }
    if (tag === "UL" || tag === "OL") {
      return `\n${Array.from(node.children).map((child) => blockMarkdown(child, depth + 1)).join("")}\n`;
    }
    if (tag === "HR") {
      return "\n\n---\n\n";
    }
    if (tag === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll(":scope > th, :scope > td"))
          .map((cell) => inlineMarkdown(cell).trim().replace(/\|/g, "\\|"))
      );
      if (!rows.length) {
        return "";
      }
      const width = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
      normalized.splice(1, 0, Array(width).fill("---"));
      return `\n\n${normalized.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
    }
    if (["A", "STRONG", "B", "EM", "I", "DEL", "S", "CODE", "IMG", "BR"].includes(tag)) {
      return inlineMarkdown(node);
    }

    return Array.from(node.childNodes)
      .map((child) => blockMarkdown(child, depth))
      .join("");
  }

  function markdownFromDom(node) {
    return core.normalizeNewlines(blockMarkdown(node));
  }

  function sourcesFromDom(node) {
    const seen = new Set();
    const sources = [];
    for (const anchor of node.querySelectorAll("a[href]")) {
      const url = safeHttpUrl(anchor.getAttribute("href"));
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      sources.push({
        title: (anchor.textContent || new URL(url).hostname).trim().slice(0, 120),
        url
      });
    }
    return sources;
  }

  function currentConversationTitle() {
    const activeLink = document.querySelector(`nav a[href="${CSS.escape(location.pathname)}"]`);
    const documentTitle = document.title.replace(/\s*[|–-]\s*ChatGPT\s*$/i, "").trim();
    return (
      activeLink?.textContent?.trim() ||
      (documentTitle && documentTitle !== "ChatGPT" ? documentTitle : "") ||
      "ChatGPT Conversation"
    ).slice(0, 160);
  }

  function extractConversationFromDom() {
    const turnCandidates = [
      ...document.querySelectorAll('[data-testid^="conversation-turn-"]'),
      ...document.querySelectorAll("article[data-turn-id]")
    ];
    if (!turnCandidates.length) {
      for (const roleNode of document.querySelectorAll("[data-message-author-role]")) {
        turnCandidates.push(roleNode.closest("article, section") || roleNode);
      }
    }

    const uniqueTurns = Array.from(new Set(turnCandidates));
    const messages = [];
    for (const turn of uniqueTurns) {
      const roleNode = turn.matches("[data-message-author-role]")
        ? turn
        : turn.querySelector("[data-message-author-role]");
      const role = roleNode?.getAttribute("data-message-author-role");
      if (!["user", "assistant"].includes(role)) {
        continue;
      }

      const preferredContent = roleNode.querySelector(
        ".markdown, .whitespace-pre-wrap, [data-message-content]"
      ) || roleNode;
      const markdown = markdownFromDom(preferredContent);
      if (!markdown) {
        continue;
      }
      const timeElement = turn.querySelector("time[datetime]");
      messages.push({
        id: String(
          roleNode.getAttribute("data-message-id") ||
          turn.getAttribute("data-turn-id") ||
          `dom-message-${messages.length + 1}`
        ),
        index: messages.length + 1,
        role,
        kind: "message",
        label: role === "user" ? "Prompt" : "Response",
        markdown,
        text: core.stripMarkdown(markdown),
        timestamp: timeElement?.getAttribute("datetime") || null,
        sources: sourcesFromDom(preferredContent)
      });
    }

    return {
      id: core.conversationIdFromUrl(location.href) || "",
      title: currentConversationTitle(),
      url: location.href,
      exportedAt: new Date().toISOString(),
      source: "visible-page",
      messages
    };
  }

  function candidateEndpoints() {
    const conversationId = core.conversationIdFromUrl(location.href);
    if (conversationId) {
      return [`/backend-api/conversation/${encodeURIComponent(conversationId)}`];
    }
    const sharedMatch = location.pathname.match(/^\/share\/([a-zA-Z0-9-]+)/);
    if (sharedMatch) {
      const id = encodeURIComponent(sharedMatch[1]);
      return [
        `/backend-api/shared_conversation/${id}`,
        `/backend-api/share/${id}`
      ];
    }
    return [];
  }

  function requestFullConversationPayload() {
    const conversationId = core.conversationIdFromUrl(location.href);
    if (!conversationId) {
      return Promise.resolve(null);
    }
    const requestId = global.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        global.removeEventListener(CONVERSATION_RESPONSE_EVENT, handleResponse);
        global.clearTimeout(timeout);
        resolve(payload);
      };
      const handleResponse = (event) => {
        try {
          const value = typeof event.detail === "string"
            ? JSON.parse(event.detail)
            : event.detail;
          if (value?.requestId === requestId) {
            finish(value.payload || null);
          }
        } catch {
          // Ignore unrelated or malformed page events.
        }
      };
      const timeout = global.setTimeout(
        () => finish(null),
        CONVERSATION_BRIDGE_TIMEOUT_MS
      );
      global.addEventListener(CONVERSATION_RESPONSE_EVENT, handleResponse);
      global.dispatchEvent(new CustomEvent(CONVERSATION_REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, conversationId })
      }));
    });
  }

  async function fetchConversationPayload(endpoint) {
    const controller = new AbortController();
    const timeout = global.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`ChatGPT returned ${response.status}`);
      }
      const payload = await response.json();
      if (!payload?.mapping || !payload?.current_node) {
        throw new Error("Conversation response did not contain an active message tree");
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadConversation() {
    try {
      const fullPayload = await requestFullConversationPayload();
      if (fullPayload?.mapping && fullPayload?.current_node) {
        const extracted = core.extractConversationFromPayload(fullPayload, location.href);
        if (extracted.messages.length) {
          return extracted;
        }
      }
    } catch (error) {
      console.debug("[ChatGPT Tools] Full conversation bridge was unavailable", error);
    }

    for (const endpoint of candidateEndpoints()) {
      try {
        const payload = await fetchConversationPayload(endpoint);
        const extracted = core.extractConversationFromPayload(payload, location.href);
        if (extracted.messages.length) {
          return extracted;
        }
      } catch (error) {
        console.debug("[ChatGPT Tools] Full conversation export fell back to the visible page", error);
      }
    }
    return extractConversationFromDom();
  }

  function exporterMarkup() {
    return `
      <button class="ct-exporter-backdrop" type="button" data-action="close" aria-label="Close exporter"></button>
      <section class="ct-exporter-panel" role="dialog" aria-modal="true" aria-labelledby="ct-exporter-title">
        <button type="button" class="ct-resize-handle" aria-label="Resize export panel" title="Drag to resize"></button>
        <header class="ct-exporter-header">
          <span class="ct-exporter-app-icon" aria-hidden="true"><img src="${core.api.runtime.getURL("icons/icon-32.png")}" alt=""></span>
          <span class="ct-exporter-heading">
            <strong id="ct-exporter-title">Export Conversation</strong>
            <small id="ct-exporter-subtitle">Preparing your conversation…</small>
          </span>
          <button type="button" class="ct-icon-button" data-action="dock" aria-label="Move panel to the other side" title="Move panel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M14 5v14"></path></svg>
          </button>
          <button type="button" class="ct-icon-button" data-action="close" aria-label="Close" title="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
          </button>
        </header>

        <div class="ct-exporter-toolbar">
          <div class="ct-segmented ct-selection-controls" role="group" aria-label="Select messages">
            <button type="button" data-select="all">All</button>
            <button type="button" data-select="questions">Prompts</button>
            <button type="button" data-select="answers">Responses</button>
            <button type="button" data-select="none">None</button>
          </div>
          <span class="ct-source-badge" id="ct-exporter-source">Local</span>
        </div>

        <div class="ct-exporter-message-list" id="ct-exporter-messages" role="list" aria-label="Conversation messages">
          <div class="ct-exporter-loading"><span class="ct-spinner"></span><span>Loading full conversation</span></div>
        </div>

        <details class="ct-export-options" id="ct-export-options">
          <summary>
            <span>Export options</span>
            <span class="ct-disclosure" aria-hidden="true">⌄</span>
          </summary>
          <div class="ct-options-content">
            <label class="ct-option-row"><span>File name</span><select data-setting="filenamePattern"><option value="title-date">Title + date</option><option value="title">Title</option><option value="date">Date</option><option value="custom">Custom</option></select></label>
            <label class="ct-option-row ct-custom-filename" hidden><span>Custom name</span><input type="text" maxlength="120" data-setting="customFilename"></label>
            <div class="ct-option-grid">
              <label><input type="checkbox" switch data-setting="includeTitle"><span>Title</span></label>
              <label><input type="checkbox" switch data-setting="includeLink"><span>Link</span></label>
              <label><input type="checkbox" switch data-setting="includeDate"><span>Export date</span></label>
              <label><input type="checkbox" switch data-setting="includeTimestamps"><span>Timestamps</span></label>
              <label><input type="checkbox" switch data-setting="includeThoughts"><span>Reasoning</span></label>
              <label><input type="checkbox" switch data-setting="includeSources"><span>Sources</span></label>
              <label><input type="checkbox" switch data-setting="copyToClipboard"><span>Copy instead</span></label>
              <label><input type="checkbox" switch data-setting="autoClose"><span>Close after export</span></label>
            </div>
            <div class="ct-pdf-options" hidden>
              <label class="ct-option-row"><span>Paper</span><select data-setting="pdfPaper"><option value="a4">A4</option><option value="letter">US Letter</option><option value="legal">US Legal</option></select></label>
              <label class="ct-option-row"><span>Margins</span><select data-setting="pdfMargins"><option value="compact">Compact</option><option value="normal">Normal</option><option value="wide">Wide</option></select></label>
              <label class="ct-option-row"><span>Appearance</span><select data-setting="pdfTheme"><option value="auto">Automatic</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
              <label class="ct-option-row"><span>Typeface</span><select data-setting="pdfFont"><option value="system">System</option><option value="serif">Serif</option><option value="mono">Monospaced</option></select></label>
              <label class="ct-option-row"><span>Text size</span><input type="range" min="11" max="20" step="1" data-setting="pdfFontSize"><output id="ct-pdf-font-size">14 pt</output></label>
              <div class="ct-option-grid">
                <label><input type="checkbox" switch data-setting="pdfToc"><span>Contents</span></label>
                <label><input type="checkbox" switch data-setting="pdfPageBreaks"><span>Page breaks</span></label>
              </div>
            </div>
          </div>
        </details>

        <footer class="ct-exporter-footer">
          <div class="ct-format-row">
            <span>Format</span>
            <div class="ct-segmented ct-format-controls" role="group" aria-label="Export format">
              <button type="button" data-format="markdown">MD</button>
              <button type="button" data-format="text">TXT</button>
              <button type="button" data-format="json">JSON</button>
              <button type="button" data-format="csv">CSV</button>
              <button type="button" data-format="pdf">PDF</button>
            </div>
          </div>
          <div class="ct-exporter-actions">
            <span class="ct-exporter-status" id="ct-exporter-status" role="status" aria-live="polite"></span>
            <button type="button" class="ct-secondary-button" data-action="close">Cancel</button>
            <button type="button" class="ct-primary-button" data-action="export" disabled>Export</button>
          </div>
        </footer>
      </section>`;
  }

  function ensureRoot() {
    if (root?.isConnected) {
      return root;
    }
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = exporterMarkup();
    document.documentElement.appendChild(root);
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
    root.addEventListener("input", handleInput);
    root.querySelector(".ct-resize-handle").addEventListener("pointerdown", handleResizeStart);
    return root;
  }

  function setStatus(message, error = false) {
    const element = root?.querySelector("#ct-exporter-status");
    if (!element) {
      return;
    }
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  function applyDock() {
    root?.setAttribute("data-dock", settings.dock);
    root?.style.setProperty("--ct-panel-width", `${settings.panelWidth}px`);
  }

  function applySettingsToControls() {
    if (!root) {
      return;
    }
    for (const control of root.querySelectorAll("[data-setting]")) {
      const key = control.dataset.setting;
      if (control.type === "checkbox") {
        control.checked = Boolean(settings[key]);
      } else {
        control.value = String(settings[key]);
      }
    }
    for (const button of root.querySelectorAll("[data-format]")) {
      const active = button.dataset.format === settings.format;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    }
    root.querySelector(".ct-custom-filename").hidden =
      settings.filenamePattern !== "custom";
    root.querySelector(".ct-pdf-options").hidden = settings.format !== "pdf";
    const copyControl = root.querySelector('[data-setting="copyToClipboard"]');
    copyControl.disabled = settings.format === "pdf";
    root.querySelector("#ct-pdf-font-size").textContent = `${settings.pdfFontSize} pt`;
    const exportButton = root.querySelector('[data-action="export"]');
    exportButton.textContent = settings.format === "pdf"
      ? "Create PDF"
      : settings.copyToClipboard ? "Copy" : "Export";
    applyDock();
  }

  function visibleMessages() {
    if (!conversation) {
      return [];
    }
    return core.filterMessages(conversation.messages, settings);
  }

  function selectedMessages() {
    return visibleMessages().filter((message) => selectedIds.has(message.id));
  }

  function updateSelectionPresentation() {
    if (!root) {
      return;
    }
    for (const input of root.querySelectorAll(".ct-message-check")) {
      input.checked = selectedIds.has(input.value);
      input.closest(".ct-message-row")?.classList.toggle("is-selected", input.checked);
      input.closest(".ct-message-row")?.setAttribute("aria-selected", String(input.checked));
    }
    const count = selectedMessages().length;
    const exportButton = root.querySelector('[data-action="export"]');
    exportButton.disabled = loading || count === 0;
    exportButton.title = count ? `Export ${count} messages` : "Select at least one message";
    setStatus(count ? `${count} selected` : "Select messages");
  }

  function renderMessages() {
    const list = root.querySelector("#ct-exporter-messages");
    list.replaceChildren();
    const messages = visibleMessages();
    if (!messages.length) {
      const empty = createElement("div", "ct-exporter-empty");
      empty.append(
        createElement("strong", "", "No messages found"),
        createElement("span", "", "Open a ChatGPT conversation and try again.")
      );
      list.appendChild(empty);
      updateSelectionPresentation();
      return;
    }

    for (const [index, message] of messages.entries()) {
      const row = createElement("div", "ct-message-row");
      row.setAttribute("role", "listitem");
      row.dataset.messageIndex = String(index);
      row.dataset.role = message.role;
      row.dataset.kind = message.kind;

      const checkbox = createElement("input", "ct-message-check");
      checkbox.type = "checkbox";
      checkbox.value = message.id;
      checkbox.setAttribute("aria-label", `Select ${message.label} ${message.index}`);

      const badge = createElement(
        "span",
        "ct-message-role",
        message.kind === "thought" ? "⌁" : message.role === "user" ? "You" : "AI"
      );
      const copy = createElement("span", "ct-message-copy");
      const heading = createElement("span", "ct-message-heading", `${message.index}. ${message.label}`);
      if (message.timestamp) {
        const time = createElement("time", "ct-message-time", new Date(message.timestamp).toLocaleString());
        time.dateTime = message.timestamp;
        heading.appendChild(time);
      }
      const preview = createElement("span", "ct-message-preview", message.text || "Empty message");
      copy.append(heading, preview);
      row.append(checkbox, badge, copy);
      list.appendChild(row);
    }
    updateSelectionPresentation();
  }

  function selectByMode(mode) {
    selectedIds.clear();
    for (const message of visibleMessages()) {
      if (
        mode === "all" ||
        (mode === "questions" && message.role === "user") ||
        (mode === "answers" && message.role !== "user")
      ) {
        selectedIds.add(message.id);
      }
    }
    lastSelectedIndex = null;
    updateSelectionPresentation();
  }

  async function updateSetting(control) {
    const key = control.dataset.setting;
    const value = control.type === "checkbox"
      ? control.checked
      : control.type === "range" ? Number.parseInt(control.value, 10) : control.value;
    settings = await core.writeSettings({ [key]: value });
    applySettingsToControls();
    if (key === "includeThoughts") {
      const visibleIds = new Set(visibleMessages().map((message) => message.id));
      selectedIds = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
      renderMessages();
    }
  }

  function handleMessageCheckboxClick(event) {
    const input = event.target.closest(".ct-message-check");
    if (!input) {
      return false;
    }
    const index = Number.parseInt(input.closest(".ct-message-row").dataset.messageIndex, 10);
    const messages = visibleMessages();
    if (event.shiftKey && lastSelectedIndex !== null) {
      const [start, end] = [lastSelectedIndex, index].sort((left, right) => left - right);
      for (let position = start; position <= end; position += 1) {
        if (input.checked) {
          selectedIds.add(messages[position].id);
        } else {
          selectedIds.delete(messages[position].id);
        }
      }
    } else if (input.checked) {
      selectedIds.add(input.value);
    } else {
      selectedIds.delete(input.value);
    }
    lastSelectedIndex = index;
    updateSelectionPresentation();
    return true;
  }

  async function handleClick(event) {
    if (handleMessageCheckboxClick(event)) {
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "close") {
      close();
      return;
    }
    if (action === "dock") {
      settings = await core.writeSettings({ dock: settings.dock === "right" ? "left" : "right" });
      applyDock();
      return;
    }
    if (action === "export") {
      await exportSelected();
      return;
    }

    const selection = event.target.closest("[data-select]")?.dataset.select;
    if (selection) {
      selectByMode(selection);
      return;
    }
    const format = event.target.closest("[data-format]")?.dataset.format;
    if (format) {
      settings = await core.writeSettings({ format });
      applySettingsToControls();
    }
  }

  function handleChange(event) {
    if (event.target.matches("[data-setting]")) {
      updateSetting(event.target).catch((error) => {
        console.error("[ChatGPT Tools] Could not save export settings", error);
        setStatus("Could not save settings", true);
      });
    }
  }

  function handleInput(event) {
    if (event.target.dataset.setting === "pdfFontSize") {
      root.querySelector("#ct-pdf-font-size").textContent = `${event.target.value} pt`;
    }
  }

  function handleResizeStart(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    resizeState = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    global.addEventListener("pointermove", handleResizeMove);
    global.addEventListener("pointerup", handleResizeEnd, { once: true });
    root.classList.add("is-resizing");
  }

  function handleResizeMove(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      return;
    }
    const rawWidth = settings.dock === "right"
      ? global.innerWidth - 12 - event.clientX
      : event.clientX - 12;
    const width = Math.max(360, Math.min(720, rawWidth));
    root.style.setProperty("--ct-panel-width", `${width}px`);
    resizeState.width = width;
  }

  function handleResizeEnd(event) {
    global.removeEventListener("pointermove", handleResizeMove);
    root?.classList.remove("is-resizing");
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      resizeState = null;
      return;
    }
    const width = resizeState.width;
    resizeState = null;
    if (width) {
      core.writeSettings({ panelWidth: width }).then((next) => {
        settings = next;
        applyDock();
      }).catch((error) => {
        console.debug("[ChatGPT Tools] Could not save panel width", error);
      });
    }
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      const textarea = createElement("textarea", "ct-clipboard-fallback");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        throw new Error("The browser denied clipboard access");
      }
    }
  }

  function downloadText(contents, filename, mime) {
    const blob = new Blob([contents], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function createPdf(messages) {
    const printWindow = global.open("about:blank", "_blank");
    if (!printWindow) {
      throw new Error("The browser blocked the print preview window");
    }
    const randomPart = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const jobId = `${PRINT_JOB_PREFIX}${randomPart}`;
    try {
      await core.api.storage.local.set({
        [jobId]: {
          createdAt: Date.now(),
          conversation,
          messages: core.filterMessages(messages, settings),
          settings
        }
      });
      printWindow.location.replace(
        `${core.api.runtime.getURL("print/print.html")}#${encodeURIComponent(jobId)}`
      );
    } catch (error) {
      printWindow.close();
      throw error;
    }
  }

  async function exportSelected() {
    const messages = selectedMessages();
    if (!messages.length || loading) {
      return;
    }
    const button = root.querySelector('[data-action="export"]');
    button.disabled = true;
    button.classList.add("is-loading");
    setStatus(settings.format === "pdf" ? "Preparing print preview…" : "Preparing export…");
    try {
      if (settings.format === "pdf") {
        await createPdf(messages);
        setStatus("Print preview opened");
      } else {
        const serialized = core.serialize(conversation, messages, settings);
        const filename = `${core.buildFilename(conversation, settings)}.${serialized.extension}`;
        if (settings.copyToClipboard) {
          await copyText(serialized.contents);
          setStatus("Copied to clipboard");
        } else {
          downloadText(serialized.contents, filename, serialized.mime);
          setStatus(`Saved ${filename}`);
        }
      }
      if (settings.autoClose) {
        global.setTimeout(close, settings.format === "pdf" ? 250 : 650);
      }
    } catch (error) {
      console.error("[ChatGPT Tools] Export failed", error);
      setStatus(error.message || "Export failed", true);
    } finally {
      button.classList.remove("is-loading");
      updateSelectionPresentation();
    }
  }

  function close() {
    if (!root) {
      return;
    }
    root.classList.remove("is-open");
    document.documentElement.classList.remove("ct-exporter-is-open");
    global.setTimeout(() => {
      if (root && !root.classList.contains("is-open")) {
        root.hidden = true;
      }
    }, 220);
  }

  async function open() {
    ensureRoot();
    root.hidden = false;
    document.documentElement.classList.add("ct-exporter-is-open");
    requestAnimationFrame(() => root.classList.add("is-open"));
    root.querySelector(".ct-exporter-panel").focus({ preventScroll: true });

    loading = true;
    conversation = null;
    selectedIds.clear();
    lastSelectedIndex = null;
    root.querySelector("#ct-exporter-subtitle").textContent = "Preparing your conversation…";
    root.querySelector("#ct-exporter-source").textContent = "Local";
    root.querySelector("#ct-exporter-messages").innerHTML =
      '<div class="ct-exporter-loading"><span class="ct-spinner"></span><span>Loading full conversation</span></div>';

    try {
      [settings, conversation] = await Promise.all([
        core.readSettings(),
        loadConversation()
      ]);
      selectedIds = new Set(conversation.messages.map((message) => message.id));
      applySettingsToControls();
      renderMessages();
      root.querySelector("#ct-exporter-subtitle").textContent =
        `${conversation.messages.length} messages · ${conversation.title}`;
      root.querySelector("#ct-exporter-source").textContent =
        conversation.source === "conversation-api" ? "Full chat" : "Loaded chat";
    } catch (error) {
      console.error("[ChatGPT Tools] Could not load conversation", error);
      root.querySelector("#ct-exporter-messages").replaceChildren();
      setStatus("Could not read this conversation", true);
    } finally {
      loading = false;
      updateSelectionPresentation();
    }
  }

  global.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root?.classList.contains("is-open")) {
      close();
    }
  });

  global.ChatGptToolsExporter = Object.freeze({
    open,
    close,
    extractConversationFromDom
  });
})(globalThis);
