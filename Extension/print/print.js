"use strict";

(async function renderPrintPreview() {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const documentRoot = document.getElementById("printDocument");
  const printButton = document.getElementById("printButton");
  const closeButton = document.getElementById("closeButton");

  function appendInlineMarkdown(parent, value) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|!?\[[^\]]*\]\([^\s)]+\))/g;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      parent.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith("`")) {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      } else if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else {
        const linkMatch = token.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
        let safeUrl = null;
        try {
          const parsed = new URL(linkMatch[3]);
          safeUrl = ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
        } catch {}
        if (safeUrl) {
          const anchor = document.createElement("a");
          anchor.href = safeUrl;
          anchor.textContent = linkMatch[2] || (linkMatch[1] ? "Image" : safeUrl);
          anchor.rel = "noreferrer noopener";
          parent.appendChild(anchor);
        } else {
          parent.appendChild(document.createTextNode(linkMatch[2] || token));
        }
      }
      cursor = match.index + token.length;
    }
    parent.appendChild(document.createTextNode(value.slice(cursor)));
  }

  function renderMarkdown(value) {
    const fragment = document.createDocumentFragment();
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let code = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      const element = document.createElement("p");
      appendInlineMarkdown(element, paragraph.join(" "));
      fragment.appendChild(element);
      paragraph = [];
    }
    function flushList() {
      if (!list) return;
      fragment.appendChild(list);
      list = null;
    }

    for (const line of lines) {
      if (line.startsWith("```")) {
        flushParagraph();
        flushList();
        if (code) {
          const pre = document.createElement("pre");
          const codeElement = document.createElement("code");
          codeElement.textContent = code.lines.join("\n");
          pre.appendChild(codeElement);
          fragment.appendChild(pre);
          code = null;
        } else {
          code = { language: line.slice(3).trim(), lines: [] };
        }
        continue;
      }
      if (code) {
        code.lines.push(line);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const element = document.createElement(`h${heading[1].length}`);
        appendInlineMarkdown(element, heading[2]);
        fragment.appendChild(element);
        continue;
      }
      const listItem = line.match(/^\s*(?:[-*+] |\d+[.)] )(.+)$/);
      if (listItem) {
        flushParagraph();
        if (!list) list = document.createElement(/^\s*\d+/.test(line) ? "ol" : "ul");
        const item = document.createElement("li");
        appendInlineMarkdown(item, listItem[1]);
        list.appendChild(item);
        continue;
      }
      if (line.startsWith("> ")) {
        flushParagraph();
        flushList();
        const quote = document.createElement("blockquote");
        appendInlineMarkdown(quote, line.slice(2));
        fragment.appendChild(quote);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
      } else {
        paragraph.push(line.trim());
      }
    }
    if (code) {
      const pre = document.createElement("pre");
      const codeElement = document.createElement("code");
      codeElement.textContent = code.lines.join("\n");
      pre.appendChild(codeElement);
      fragment.appendChild(pre);
    }
    flushParagraph();
    flushList();
    return fragment;
  }

  function timestampLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  function applyPrintSettings(settings) {
    const root = document.documentElement;
    root.dataset.theme = settings.pdfTheme;
    root.dataset.font = settings.pdfFont;
    root.dataset.margins = settings.pdfMargins;
    root.dataset.pageBreaks = String(settings.pdfPageBreaks);
    root.style.setProperty("--ct-body-size", `${settings.pdfFontSize}px`);

    const paperSizes = { a4: "A4", letter: "Letter", legal: "Legal" };
    const margins = { compact: "12mm", normal: "18mm", wide: "25mm" };
    const pageStyle = document.createElement("style");
    pageStyle.textContent = `@page { size: ${paperSizes[settings.pdfPaper] || "A4"}; margin: ${margins[settings.pdfMargins] || "18mm"}; }`;
    document.head.appendChild(pageStyle);
  }

  function renderJob(job) {
    const { conversation, messages, settings } = job;
    applyPrintSettings(settings);
    document.title = `${conversation.title} — ChatGPT Tools`;
    documentRoot.replaceChildren();

    const header = document.createElement("header");
    header.className = "ct-document-header";
    if (settings.includeTitle) {
      const title = document.createElement("h1");
      title.textContent = conversation.title;
      header.appendChild(title);
    }
    const metadata = document.createElement("div");
    metadata.className = "ct-document-meta";
    if (settings.includeLink && conversation.url) {
      const link = document.createElement("a");
      link.href = conversation.url;
      link.textContent = "Open conversation";
      metadata.appendChild(link);
    }
    if (settings.includeDate) {
      const date = document.createElement("span");
      date.textContent = `Exported ${timestampLabel(conversation.exportedAt)}`;
      metadata.appendChild(date);
    }
    if (metadata.childNodes.length) header.appendChild(metadata);
    if (header.childNodes.length) documentRoot.appendChild(header);

    if (settings.pdfToc) {
      const toc = document.createElement("nav");
      toc.className = "ct-toc";
      const title = document.createElement("h2");
      title.textContent = "Contents";
      const list = document.createElement("ol");
      for (const message of messages) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#ct-print-message-${message.index}`;
        link.textContent = `${message.index}. ${message.label}`;
        item.appendChild(link);
        list.appendChild(item);
      }
      toc.append(title, list);
      documentRoot.appendChild(toc);
    }

    for (const message of messages) {
      const article = document.createElement("article");
      article.className = "ct-print-message";
      article.dataset.role = message.role;
      article.id = `ct-print-message-${message.index}`;
      const heading = document.createElement("h2");
      heading.className = "ct-message-title";
      const label = document.createElement("span");
      label.textContent = `${message.index}. ${message.label}`;
      heading.appendChild(label);
      if (settings.includeTimestamps && message.timestamp) {
        const time = document.createElement("time");
        time.dateTime = message.timestamp;
        time.textContent = timestampLabel(message.timestamp);
        heading.appendChild(time);
      }
      const content = document.createElement("div");
      content.className = "ct-message-content";
      content.appendChild(renderMarkdown(message.markdown));
      article.append(heading, content);

      if (settings.includeSources && message.sources?.length) {
        const sources = document.createElement("section");
        sources.className = "ct-message-sources";
        const sourceHeading = document.createElement("strong");
        sourceHeading.textContent = "Sources";
        const list = document.createElement("ul");
        for (const source of message.sources) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = source.url;
          link.textContent = source.title || source.url;
          item.appendChild(link);
          list.appendChild(item);
        }
        sources.append(sourceHeading, list);
        article.appendChild(sources);
      }
      documentRoot.appendChild(article);
    }
  }

  printButton.addEventListener("click", () => window.print());
  closeButton.addEventListener("click", () => window.close());

  try {
    const jobId = decodeURIComponent(location.hash.slice(1));
    if (!/^ct_print_job_[a-zA-Z0-9.-]+$/.test(jobId)) {
      throw new Error("This print preview link is invalid or expired.");
    }
    const stored = await api.storage.local.get(jobId);
    const job = stored?.[jobId];
    if (!job?.conversation || !Array.isArray(job.messages) || !job.settings) {
      throw new Error("The print job is no longer available.");
    }
    renderJob(job);
    await api.storage.local.remove(jobId);
    window.setTimeout(() => window.print(), 450);
  } catch (error) {
    const message = document.createElement("div");
    message.className = "ct-print-error";
    message.textContent = error.message || "Could not prepare the document.";
    documentRoot.replaceChildren(message);
    printButton.disabled = true;
  }
})();
