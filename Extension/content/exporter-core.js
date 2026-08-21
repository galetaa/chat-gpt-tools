"use strict";

(function installExporterCore(global) {
  const api = typeof global.browser !== "undefined"
    ? global.browser
    : global.chrome;

  const SETTINGS_KEY = "ct_export_settings";
  const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
    format: "markdown",
    dock: "right",
    panelWidth: 470,
    includeTitle: true,
    includeLink: true,
    includeDate: true,
    includeTimestamps: false,
    includeThoughts: true,
    includeSources: true,
    copyToClipboard: false,
    autoClose: true,
    filenamePattern: "title-date",
    customFilename: "ChatGPT Conversation",
    pdfPaper: "a4",
    pdfMargins: "normal",
    pdfTheme: "auto",
    pdfFont: "system",
    pdfFontSize: 14,
    pdfToc: false,
    pdfPageBreaks: false
  });

  const FORMATS = new Set(["markdown", "text", "json", "csv", "pdf"]);
  const DOCKS = new Set(["left", "right"]);
  const FILENAME_PATTERNS = new Set([
    "title",
    "date",
    "title-date",
    "custom"
  ]);
  const PDF_PAPERS = new Set(["a4", "letter", "legal"]);
  const PDF_MARGINS = new Set(["compact", "normal", "wide"]);
  const PDF_THEMES = new Set(["auto", "light", "dark"]);
  const PDF_FONTS = new Set(["system", "serif", "mono"]);

  function booleanOrDefault(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function enumOrDefault(value, allowed, fallback) {
    return allowed.has(value) ? value : fallback;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed)
      ? Math.max(minimum, Math.min(maximum, parsed))
      : fallback;
  }

  function cleanSingleLine(value, fallback, maximum = 120) {
    const text = String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (text || fallback).slice(0, maximum);
  }

  function normalizeSettings(input = {}) {
    const candidate = input && typeof input === "object" ? input : {};
    return {
      version: 1,
      format: enumOrDefault(
        candidate.format,
        FORMATS,
        DEFAULT_SETTINGS.format
      ),
      dock: enumOrDefault(candidate.dock, DOCKS, DEFAULT_SETTINGS.dock),
      panelWidth: clampInteger(candidate.panelWidth, 360, 720, DEFAULT_SETTINGS.panelWidth),
      includeTitle: booleanOrDefault(
        candidate.includeTitle,
        DEFAULT_SETTINGS.includeTitle
      ),
      includeLink: booleanOrDefault(
        candidate.includeLink,
        DEFAULT_SETTINGS.includeLink
      ),
      includeDate: booleanOrDefault(
        candidate.includeDate,
        DEFAULT_SETTINGS.includeDate
      ),
      includeTimestamps: booleanOrDefault(
        candidate.includeTimestamps,
        DEFAULT_SETTINGS.includeTimestamps
      ),
      includeThoughts: booleanOrDefault(
        candidate.includeThoughts,
        DEFAULT_SETTINGS.includeThoughts
      ),
      includeSources: booleanOrDefault(
        candidate.includeSources,
        DEFAULT_SETTINGS.includeSources
      ),
      copyToClipboard: booleanOrDefault(
        candidate.copyToClipboard,
        DEFAULT_SETTINGS.copyToClipboard
      ),
      autoClose: booleanOrDefault(
        candidate.autoClose,
        DEFAULT_SETTINGS.autoClose
      ),
      filenamePattern: enumOrDefault(
        candidate.filenamePattern,
        FILENAME_PATTERNS,
        DEFAULT_SETTINGS.filenamePattern
      ),
      customFilename: cleanSingleLine(
        candidate.customFilename,
        DEFAULT_SETTINGS.customFilename
      ),
      pdfPaper: enumOrDefault(
        candidate.pdfPaper,
        PDF_PAPERS,
        DEFAULT_SETTINGS.pdfPaper
      ),
      pdfMargins: enumOrDefault(
        candidate.pdfMargins,
        PDF_MARGINS,
        DEFAULT_SETTINGS.pdfMargins
      ),
      pdfTheme: enumOrDefault(
        candidate.pdfTheme,
        PDF_THEMES,
        DEFAULT_SETTINGS.pdfTheme
      ),
      pdfFont: enumOrDefault(
        candidate.pdfFont,
        PDF_FONTS,
        DEFAULT_SETTINGS.pdfFont
      ),
      pdfFontSize: clampInteger(
        candidate.pdfFontSize,
        11,
        20,
        DEFAULT_SETTINGS.pdfFontSize
      ),
      pdfToc: booleanOrDefault(candidate.pdfToc, DEFAULT_SETTINGS.pdfToc),
      pdfPageBreaks: booleanOrDefault(
        candidate.pdfPageBreaks,
        DEFAULT_SETTINGS.pdfPageBreaks
      )
    };
  }

  async function readSettings() {
    const stored = await api.storage.local.get(SETTINGS_KEY);
    const normalized = normalizeSettings(stored?.[SETTINGS_KEY]);
    await api.storage.local.set({ [SETTINGS_KEY]: normalized });
    return normalized;
  }

  async function writeSettings(patch) {
    const current = await readSettings();
    const next = normalizeSettings({ ...current, ...patch });
    await api.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function normalizeNewlines(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripMarkdown(value) {
    return normalizeNewlines(String(value || "")
      .replace(/```[^\n]*\n?/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/(\*\*|__|~~|`)/g, ""));
  }

  function sanitizeFilename(value) {
    const cleaned = cleanSingleLine(value, "ChatGPT Conversation", 160)
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/[. ]+$/g, "")
      .replace(/\s{2,}/g, " ");
    return cleaned || "ChatGPT Conversation";
  }

  function localDateStamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function buildFilename(conversation, settings, date = new Date()) {
    const title = sanitizeFilename(conversation.title);
    const dateStamp = localDateStamp(date);
    let base = title;
    if (settings.filenamePattern === "date") {
      base = `ChatGPT ${dateStamp}`;
    } else if (settings.filenamePattern === "title-date") {
      base = `${title} ${dateStamp}`;
    } else if (settings.filenamePattern === "custom") {
      base = settings.customFilename;
    }
    return sanitizeFilename(base);
  }

  function conversationIdFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const match = url.pathname.match(/^\/c\/([a-zA-Z0-9-]+)/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }

  function buildActivePath(payload) {
    const mapping = payload?.mapping;
    let nodeId = payload?.current_node;
    if (!mapping || typeof mapping !== "object" || !nodeId) {
      return [];
    }

    const path = [];
    const visited = new Set();
    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!node || typeof node !== "object") {
        return [];
      }
      path.push(node);
      nodeId = node.parent || null;
    }

    if (nodeId) {
      return [];
    }
    return path.reverse();
  }

  function contentTypeOf(message) {
    return String(message?.content?.content_type || "text").toLowerCase();
  }

  function isThoughtMessage(message) {
    const type = contentTypeOf(message);
    return (
      type.includes("thought") ||
      type.includes("reason") ||
      message?.author?.role === "thinking"
    );
  }

  function partToMarkdown(part) {
    if (typeof part === "string") {
      return part;
    }
    if (!part || typeof part !== "object") {
      return "";
    }
    if (typeof part.text === "string") {
      return part.text;
    }
    if (typeof part.content === "string") {
      return part.content;
    }
    if (typeof part.result === "string") {
      return part.result;
    }

    const contentType = String(part.content_type || part.type || "");
    const rawUrl = part.url || part.download_url || part.image_url;
    if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl)) {
      const label = cleanSingleLine(part.name || part.title, "Attachment");
      return contentType.includes("image")
        ? `![${label}](${rawUrl})`
        : `[${label}](${rawUrl})`;
    }
    if (contentType.includes("image") || part.asset_pointer) {
      return "[Image]";
    }
    return "";
  }

  function contentToMarkdown(message) {
    const content = message?.content;
    if (!content || typeof content !== "object") {
      return "";
    }

    let parts = [];
    if (Array.isArray(content.parts)) {
      parts = content.parts.map(partToMarkdown);
    } else if (typeof content.text === "string") {
      parts = [content.text];
    } else if (typeof content.result === "string") {
      parts = [content.result];
    }

    let markdown = normalizeNewlines(parts.filter(Boolean).join("\n\n"));
    const type = contentTypeOf(message);
    if (markdown && (type === "code" || type.includes("execution_output"))) {
      const language = cleanSingleLine(content.language, "", 32);
      markdown = `\`\`\`${language}\n${markdown}\n\`\`\``;
    }
    return markdown;
  }

  function collectSources(value, results = [], seen = new Set(), depth = 0) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) {
      return results;
    }
    seen.add(value);

    if (!Array.isArray(value)) {
      const rawUrl = value.url || value.source_url || value.href;
      if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl)) {
        let fallbackTitle = "Source";
        try {
          fallbackTitle = new URL(rawUrl).hostname;
        } catch {
          // Invalid URLs are ignored below by consumers and stay safely textual.
        }
        results.push({
          title: cleanSingleLine(
            value.title || value.name || value.attribution,
            fallbackTitle
          ),
          url: rawUrl
        });
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        collectSources(child, results, seen, depth + 1);
      }
    }
    return results;
  }

  function uniqueSources(values) {
    const seen = new Set();
    return values.filter((source) => {
      if (!source?.url || seen.has(source.url)) {
        return false;
      }
      seen.add(source.url);
      return true;
    });
  }

  function extractConversationFromPayload(payload, rawUrl) {
    const path = buildActivePath(payload);
    const messages = [];

    for (const node of path) {
      const message = node?.message;
      const originalRole = message?.author?.role;
      if (!message || !["user", "assistant", "thinking"].includes(originalRole)) {
        continue;
      }

      const markdown = contentToMarkdown(message);
      if (!markdown) {
        continue;
      }

      const thought = isThoughtMessage(message);
      const sources = uniqueSources([
        ...collectSources(message.metadata),
        ...collectSources(message.content)
      ]);
      const timestamp = Number.isFinite(message.create_time)
        ? new Date(message.create_time * 1000).toISOString()
        : null;
      messages.push({
        id: String(message.id || node.id || `message-${messages.length + 1}`),
        index: messages.length + 1,
        role: originalRole === "user" ? "user" : "assistant",
        kind: thought ? "thought" : "message",
        label: originalRole === "user"
          ? "Prompt"
          : thought ? "Reasoning" : "Response",
        markdown,
        text: stripMarkdown(markdown),
        timestamp,
        sources
      });
    }

    return {
      id: String(payload?.conversation_id || conversationIdFromUrl(rawUrl) || ""),
      title: cleanSingleLine(payload?.title, "ChatGPT Conversation"),
      url: rawUrl,
      exportedAt: new Date().toISOString(),
      source: "conversation-api",
      messages
    };
  }

  function timestampLabel(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  function messageHeading(message, settings) {
    const time = settings.includeTimestamps
      ? timestampLabel(message.timestamp)
      : "";
    return time ? `${message.label} · ${time}` : message.label;
  }

  function sourceMarkdown(sources) {
    if (!sources.length) {
      return "";
    }
    return [
      "**Sources**",
      ...sources.map((source) => `- [${source.title}](${source.url})`)
    ].join("\n");
  }

  function metadataLines(conversation, settings, prefix = "") {
    const lines = [];
    if (settings.includeLink && conversation.url) {
      lines.push(`${prefix}Link: ${conversation.url}`);
    }
    if (settings.includeDate) {
      lines.push(`${prefix}Exported: ${timestampLabel(conversation.exportedAt)}`);
    }
    return lines;
  }

  function filterMessages(messages, settings) {
    return messages.filter(
      (message) => settings.includeThoughts || message.kind !== "thought"
    );
  }

  function formatMarkdown(conversation, messages, settings) {
    const output = [];
    if (settings.includeTitle) {
      output.push(`# ${conversation.title}`);
    }
    output.push(...metadataLines(conversation, settings, ""));

    for (const message of filterMessages(messages, settings)) {
      const block = [
        `## ${messageHeading(message, settings)}`,
        message.markdown
      ];
      if (settings.includeSources) {
        const sources = sourceMarkdown(message.sources || []);
        if (sources) {
          block.push(sources);
        }
      }
      output.push(block.join("\n\n"));
    }
    return normalizeNewlines(output.join("\n\n")) + "\n";
  }

  function formatText(conversation, messages, settings) {
    const output = [];
    if (settings.includeTitle) {
      output.push(conversation.title, "=".repeat(Math.min(72, conversation.title.length)));
    }
    output.push(...metadataLines(conversation, settings));

    for (const message of filterMessages(messages, settings)) {
      output.push(messageHeading(message, settings).toUpperCase());
      output.push(message.text);
      if (settings.includeSources && message.sources?.length) {
        output.push(
          "Sources:",
          ...message.sources.map((source) => `- ${source.title}: ${source.url}`)
        );
      }
    }
    return normalizeNewlines(output.join("\n\n")) + "\n";
  }

  function exportObject(conversation, messages, settings) {
    return {
      title: settings.includeTitle ? conversation.title : undefined,
      url: settings.includeLink ? conversation.url : undefined,
      exportedAt: settings.includeDate ? conversation.exportedAt : undefined,
      source: conversation.source,
      messages: filterMessages(messages, settings).map((message) => ({
        index: message.index,
        role: message.role,
        type: message.kind,
        timestamp: settings.includeTimestamps ? message.timestamp : undefined,
        content: message.markdown,
        sources: settings.includeSources ? message.sources : undefined
      }))
    };
  }

  function escapeCsv(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function formatCsv(conversation, messages, settings) {
    const rows = [["Index", "Role", "Type", "Timestamp", "Content", "Sources"]];
    for (const message of filterMessages(messages, settings)) {
      rows.push([
        message.index,
        message.role,
        message.kind,
        settings.includeTimestamps ? message.timestamp || "" : "",
        message.text,
        settings.includeSources
          ? (message.sources || []).map((source) => source.url).join("\n")
          : ""
      ]);
    }
    return `\ufeff${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
  }

  function serialize(conversation, messages, settings) {
    if (settings.format === "text") {
      return { contents: formatText(conversation, messages, settings), extension: "txt", mime: "text/plain;charset=utf-8" };
    }
    if (settings.format === "json") {
      return { contents: `${JSON.stringify(exportObject(conversation, messages, settings), null, 2)}\n`, extension: "json", mime: "application/json;charset=utf-8" };
    }
    if (settings.format === "csv") {
      return { contents: formatCsv(conversation, messages, settings), extension: "csv", mime: "text/csv;charset=utf-8" };
    }
    return { contents: formatMarkdown(conversation, messages, settings), extension: "md", mime: "text/markdown;charset=utf-8" };
  }

  global.ChatGptToolsExporterCore = Object.freeze({
    api,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    readSettings,
    writeSettings,
    normalizeNewlines,
    stripMarkdown,
    sanitizeFilename,
    buildFilename,
    conversationIdFromUrl,
    buildActivePath,
    extractConversationFromPayload,
    filterMessages,
    formatMarkdown,
    formatText,
    formatCsv,
    exportObject,
    serialize
  });
})(globalThis);
