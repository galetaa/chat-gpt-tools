<p align="center">
  <img src="Design/chat-gpt-tools-icon.svg" width="128" height="128" alt="ChatGPT Tools icon">
</p>

<h1 align="center">ChatGPT Tools</h1>

<p align="center">
  Faster long conversations and private, on-device exports — for Safari and Chromium.
</p>

<p align="center">
  <a href="https://github.com/galetaa/chat-gpt-tools/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/galetaa/chat-gpt-tools?style=flat-square&color=0A84FF"></a>
  <a href="https://github.com/galetaa/chat-gpt-tools/actions/workflows/verify.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/galetaa/chat-gpt-tools/verify.yml?branch=main&style=flat-square&label=checks"></a>
  <img alt="Safari 18+" src="https://img.shields.io/badge/Safari-18%2B-0A84FF?style=flat-square&logo=safari&logoColor=white">
  <img alt="Chromium 111+" src="https://img.shields.io/badge/Chromium-111%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white">
  <img alt="On-device" src="https://img.shields.io/badge/privacy-on--device-30D158?style=flat-square">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#export">Export</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#development">Development</a>
</p>

---

ChatGPT Tools keeps long ChatGPT conversations responsive by limiting how much history the page has to render. The complete loaded branch remains available to the built-in exporter — with no cloud service, analytics, or third-party processing of your conversations.

> [!IMPORTANT]
> GitHub releases contain developer packages for Chromium and Safari. Chromium builds can be loaded unpacked immediately. Safari supports temporary unsigned loading on macOS; permanent Safari installation and distribution require an app container created and signed with Xcode.

## Features

| | Feature | What it does |
|---|---|---|
| ⚡️ | **Faster long conversations** | Gives the ChatGPT interface only the most recent messages instead of rendering the entire history. |
| 🎚️ | **Precise message limit** | Use the slider or enter a value directly: `1–20` normally, or `1–100` with `Extended range`. |
| 🔄 | **Live limit changes** | Apply a new message limit immediately without reloading or navigating away from the conversation. |
| 📦 | **Complete local export** | Select individual messages and save the conversation as Markdown, TXT, JSON, CSV, or PDF. |
| 🧠 | **Context preserved** | Includes reasoning, timestamps, links, and sources when they are present in the loaded conversation. |
| 🔒 | **Private by default** | No extension account, telemetry, ads, remote configuration, or third-party API. |
| ✨ | **Polished interface** | Responsive popup and export panel with light, dark, reduced-motion, and high-contrast support. |

### How performance mode works

1. An early page script inspects the active conversation response before the ChatGPT interface processes it.
2. The page receives only the latest `N` visible message groups.
3. The complete branch is kept temporarily in the tab's memory for export and discarded when you open another conversation.
4. If ChatGPT embeds the conversation in its initial HTML, a reversible DOM fallback removes older messages from layout and paint without deleting their data.

Unexpected response formats are handled with a **fail-open** strategy: the extension leaves the response unchanged and does not prevent ChatGPT from loading.

## Installation

### Chromium browsers

This build targets Chrome, Chromium, Edge, Brave, Vivaldi, and other current Chromium-based desktop browsers.

1. Download `ChatGPT-Tools-Chromium.zip` from the [latest release](https://github.com/galetaa/chat-gpt-tools/releases/latest) and extract it.
2. Open your browser's extensions page, such as `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Open [chatgpt.com](https://chatgpt.com). The extension starts automatically after installation.

Pin **ChatGPT Tools** to the toolbar for quick access to message limits and conversation export.

### Safari: quick setup on macOS

1. Download `ChatGPT-Tools-Safari.zip` from the [latest release](https://github.com/galetaa/chat-gpt-tools/releases/latest) and extract it.
2. Open **Safari → Settings → Advanced** and enable web developer features.
3. Open **Settings → Developer** and enable **Allow unsigned extensions**.
4. Choose **Add Temporary Extension** and select the extracted folder containing `manifest.json`.
5. Enable **ChatGPT Tools for Safari** under **Settings → Extensions**.
6. Open [chatgpt.com](https://chatgpt.com) and allow the extension to access the website.

Safari disables unsigned extensions when the app quits. Use Xcode for a permanent installation.

### Safari: permanent installation with Xcode

Install the full version of Xcode, launch it at least once, and accept its license agreement. Then run:

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  ./package-safari.sh com.yourname.chatgpttools.safari
```

Open the generated project in `SafariApp/`, choose your Apple Development Team for both the app and extension targets, then build and run the container. The final script argument accepts `all`, `macos`, or `ios`.

## Usage

1. Select the extension button in the browser toolbar.
2. Enable **Optimize long chats**.
3. Choose the number of messages with the slider or enter it directly.
4. Enable **Extended range** to use values up to `100`.
5. Change the limit at any time. Messages already loaded in the tab are hidden or restored immediately without reloading the conversation.

After installing or updating the extension, reload an existing ChatGPT tab once so its content scripts can start. Live limit changes do not reload the page, which makes them safe to use in Temporary Chats. If the page was originally loaded with a smaller network limit, increasing the value can restore only messages that are still available in the current tab; reopening a persistent conversation is required to request additional history from ChatGPT.

The compact indicator in the bottom-right corner shows how many messages are displayed and hidden. Disabling optimization restores messages hidden by the DOM fallback without losing their content.

## Export

Select **Export Conversation** in the main popup. The sidebar lets you:

- select every message, prompts only, or responses only;
- select individual messages and `Shift` ranges;
- include the title, conversation link, export date, timestamps, reasoning, and sources;
- save the conversation as `.md`, `.txt`, `.json`, or `.csv`;
- copy the generated output to the clipboard;
- prepare a PDF through the browser's standard system print dialog.

PDF output is generated locally. Choose **Save as PDF** in the print dialog to save it.

## Privacy

The extension requests only:

- `storage` for local interface and export settings;
- access to `https://chatgpt.com/*` and `https://chat.openai.com/*` so it can operate inside the open ChatGPT tab.

Conversation content is never sent to the developer or a third-party service. Markdown, TXT, JSON, and CSV files are generated in the current tab. Temporary PDF job data is removed from local extension storage as soon as the print preview opens.

There is no background service worker, remote code, analytics endpoint, externally connectable origin, or broad `<all_urls>` access.

## Compatibility and limitations

- Chromium 111 or later is required for static `MAIN`-world content scripts.
- Safari 18 or later is recommended for the equivalent early interception path.
- ChatGPT's internal conversation endpoint and DOM are not public APIs and may change.
- Optimization and complete export should be retested after major ChatGPT updates.
- Incognito windows, Private Browsing, and separate browser profiles require their own extension permission settings.

Safari version `2.0.2` was tested on August 21, 2026 in an authenticated session. With the status showing `10 shown / 2 hidden`, the exporter still received all 12 original messages. Chromium version `2.1.0` was runtime smoke-tested on Thorium 138 and successfully packed by Google Chrome 152 on September 12, 2026. The test covered popup settings, cross-context messaging, response trimming, full-payload export recovery, the status indicator, exporter opening, and local PDF rendering.

## Development

Automated verification requires Node.js 20 or later. The project has no external npm dependencies.

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools
npm run verify
```

This command builds the Chromium variant, validates both manifests, compares every shared file, checks resource paths, CSP and JavaScript syntax, then runs the optimization and export test suite.

### Build Chromium locally

```sh
npm run build:chromium
```

Load the generated `Build/ChromiumExtension/` directory through **Load unpacked**. To create a release archive:

```sh
npm run package:chromium
```

The resulting `ChatGPT-Tools-Chromium.zip` has `manifest.json` at its root and is ready to extract and load unpacked.

### Project structure

```text
Extension/                   # shared web-extension source and Safari manifest
├── content/                 # DOM optimization, status indicator, and exporter
├── icons/                   # browser icon set
├── popup/                   # main extension popup
├── print/                   # local PDF and print preview
└── scripts/                 # page-world interceptor and trimming algorithm

platforms/chromium/          # Chromium-specific Manifest V3 overlay
Build/ChromiumExtension/     # generated unpacked Chromium build
Design/                      # editable SVG icon source
tests/                       # browser-independent unit tests
tools/                       # build and validation scripts
```

Technical notes:

- [Chromium adaptation notes](CHROMIUM_PORTING_NOTES.md);
- [Chromium-to-Safari porting notes](PORTING_NOTES.md);
- [exporter integration notes](EXPORTER_PORTING_NOTES.md);
- [performance research](PERFORMANCE_RESEARCH.md);
- [changelog](CHANGELOG.md).

If a ChatGPT update changes the extension's behavior, [open an issue](https://github.com/galetaa/chat-gpt-tools/issues/new) and include your operating system, browser, and extension versions.

---

<p align="center">
  Built for fast, long conversations — without compromising privacy.
</p>
