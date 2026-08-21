"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const exporterCoreSource = fs.readFileSync(
  path.resolve(__dirname, "../Extension/content/exporter-core.js"),
  "utf8"
);

function createRuntime(initialSettings) {
  const storage = { ct_export_settings: initialSettings };
  const browser = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    }
  };
  const context = vm.createContext({ browser, URL, Date, console });
  vm.runInContext(exporterCoreSource, context, { filename: "exporter-core.js" });
  return { core: context.ChatGptToolsExporterCore, storage };
}

function conversationPayload() {
  return {
    conversation_id: "conversation-1",
    title: "Safari export / test",
    current_node: "a1",
    mapping: {
      root: {
        id: "root",
        parent: null,
        message: {
          id: "system",
          author: { role: "system" },
          content: { content_type: "text", parts: ["hidden system text"] }
        }
      },
      u1: {
        id: "u1",
        parent: "root",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: 1_700_000_000,
          content: { content_type: "text", parts: ["Show **all** formats"] }
        }
      },
      t1: {
        id: "t1",
        parent: "u1",
        message: {
          id: "t1",
          author: { role: "assistant" },
          content: { content_type: "thoughts", parts: ["Private reasoning"] }
        }
      },
      a1: {
        id: "a1",
        parent: "t1",
        message: {
          id: "a1",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Here is the result."] },
          metadata: {
            content_references: [{
              title: "Example source",
              url: "https://example.com/source"
            }]
          }
        }
      },
      ignoredBranch: {
        id: "ignoredBranch",
        parent: "u1",
        message: {
          id: "ignoredBranch",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Side branch"] }
        }
      }
    }
  };
}

test("extractor follows the active branch and keeps reasoning and sources", () => {
  const { core } = createRuntime();
  const conversation = core.extractConversationFromPayload(
    conversationPayload(),
    "https://chatgpt.com/c/conversation-1"
  );

  assert.equal(conversation.messages.length, 3);
  assert.deepEqual(
    Array.from(conversation.messages, (message) => message.label),
    ["Prompt", "Reasoning", "Response"]
  );
  assert.equal(conversation.messages[2].sources[0].url, "https://example.com/source");
  assert.equal(conversation.messages.some((message) => message.markdown === "Side branch"), false);
});

test("reasoning can be excluded without removing assistant responses", () => {
  const { core } = createRuntime();
  const conversation = core.extractConversationFromPayload(
    conversationPayload(),
    "https://chatgpt.com/c/conversation-1"
  );
  const settings = core.normalizeSettings({ includeThoughts: false });
  const filtered = core.filterMessages(conversation.messages, settings);

  assert.deepEqual(
    Array.from(filtered, (message) => message.label),
    ["Prompt", "Response"]
  );
});

test("all local export formats contain selected conversation data", () => {
  const { core } = createRuntime();
  const conversation = core.extractConversationFromPayload(
    conversationPayload(),
    "https://chatgpt.com/c/conversation-1"
  );
  const selected = [conversation.messages[0], conversation.messages[2]];

  const markdown = core.serialize(
    conversation,
    selected,
    core.normalizeSettings({ format: "markdown" })
  );
  const text = core.serialize(
    conversation,
    selected,
    core.normalizeSettings({ format: "text" })
  );
  const json = core.serialize(
    conversation,
    selected,
    core.normalizeSettings({ format: "json" })
  );
  const csv = core.serialize(
    conversation,
    selected,
    core.normalizeSettings({ format: "csv" })
  );

  assert.equal(markdown.extension, "md");
  assert.match(markdown.contents, /# Safari export \/ test/);
  assert.match(markdown.contents, /\[Example source\]\(https:\/\/example.com\/source\)/);
  assert.equal(text.extension, "txt");
  assert.match(text.contents, /SHOW ALL FORMATS/i);
  assert.equal(json.extension, "json");
  assert.equal(JSON.parse(json.contents).messages.length, 2);
  assert.equal(csv.extension, "csv");
  assert.equal(csv.contents.startsWith("\ufeff"), true);
  assert.match(csv.contents, /https:\/\/example.com\/source/);
});

test("settings are normalized and unsafe filename characters are removed", async () => {
  const { core, storage } = createRuntime({
    format: "invalid",
    pdfFontSize: 200,
    customFilename: "  Export: Safari / Chat?  "
  });
  const settings = await core.readSettings();

  assert.equal(settings.format, "markdown");
  assert.equal(settings.pdfFontSize, 20);
  assert.equal(storage.ct_export_settings.version, 1);
  assert.equal(
    core.buildFilename(
      { title: "ignored" },
      core.normalizeSettings({ filenamePattern: "custom", customFilename: settings.customFilename })
    ),
    "Export- Safari - Chat-"
  );
});
