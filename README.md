<p align="center">
  <img src="Design/chat-gpt-tools-icon.svg" width="128" height="128" alt="ChatGPT Tools icon">
</p>

<h1 align="center">ChatGPT Tools for Safari</h1>

<p align="center">
  Faster long conversations and private, on-device exports — built for Safari.
</p>

<p align="center">
  <a href="https://github.com/galetaa/chat-gpt-tools/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/galetaa/chat-gpt-tools?style=flat-square&color=0A84FF"></a>
  <a href="https://github.com/galetaa/chat-gpt-tools/actions/workflows/verify.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/galetaa/chat-gpt-tools/verify.yml?branch=main&style=flat-square&label=checks"></a>
  <img alt="Safari 18+" src="https://img.shields.io/badge/Safari-18%2B-0A84FF?style=flat-square&logo=safari&logoColor=white">
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

ChatGPT Tools keeps long ChatGPT conversations responsive in Safari by limiting how much history the page has to render. The complete loaded branch remains available to the built-in exporter — with no cloud service, analytics, or third-party processing of your conversations.

> [!IMPORTANT]
> The GitHub release contains a developer build of the Safari Web Extension. You can load it temporarily as an unsigned extension on macOS. Permanent installation and distribution require an app container created and signed with Xcode.

## Features

| | Feature | What it does |
|---|---|---|
| ⚡️ | **Faster long conversations** | Gives the ChatGPT interface only the most recent messages instead of rendering the entire history. |
| 🎚️ | **Precise message limit** | Use the slider or enter a value directly: `1–20` normally, or `1–100` with `Extended range`. |
| 📦 | **Complete local export** | Select individual messages and save the conversation as Markdown, TXT, JSON, CSV, or PDF. |
| 🧠 | **Context preserved** | Includes reasoning, timestamps, links, and sources when they are present in the loaded conversation. |
| 🔒 | **Private by default** | No extension account, telemetry, ads, remote configuration, or third-party API. |
| 🍎 | **macOS-native design** | System materials, grouped lists, light and dark appearances, and accessibility settings. |

### How performance mode works

1. An early page script inspects the active conversation response before the ChatGPT interface processes it.
2. The page receives only the latest `N` visible message groups.
3. The complete branch is kept temporarily in the tab's memory for export and discarded when you open another conversation.
4. If ChatGPT embeds the conversation in its initial HTML, a reversible DOM fallback removes older messages from layout and paint without deleting their data.

Unexpected response formats are handled with a **fail-open** strategy: the extension leaves the response unchanged and does not prevent ChatGPT from loading.

## Installation

### Quick setup on macOS

1. Download `ChatGPT-Tools-Safari.zip` from the [latest release](https://github.com/galetaa/chat-gpt-tools/releases/latest) and extract it.
2. Open **Safari → Settings → Advanced** and enable web developer features.
3. Open **Settings → Developer** and enable **Allow unsigned extensions**.
4. Choose **Add Temporary Extension** and select the extracted folder containing `manifest.json`.
5. Enable **ChatGPT Tools for Safari** under **Settings → Extensions**.
6. Open [chatgpt.com](https://chatgpt.com) and allow the extension to access the website.

Safari disables unsigned extensions when the app quits. Use Xcode for a permanent installation.

### Permanent installation with Xcode

Install the full version of Xcode, launch it at least once, and accept its license agreement. Then run:

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  ./package-safari.sh com.yourname.chatgpttools.safari
```

Open the generated project in `SafariApp/`, choose your Apple Development Team for both the app and extension targets, then build and run the container. You can also generate a project for one platform only:

```sh
./package-safari.sh com.yourname.chatgpttools.safari /path/to/output macos
./package-safari.sh com.yourname.chatgpttools.safari /path/to/output ios
```

The final argument accepts `all`, `macos`, or `ios`. The macOS extension has been tested manually; the iOS and iPadOS targets require separate testing and signing in Xcode.

## Usage

1. Select the extension button in the Safari toolbar.
2. Enable **Optimize long chats**.
3. Choose the number of messages with the slider or enter it directly.
4. Enable **Extended range** to use values up to `100`.
5. Reload an already open long conversation so early optimization can be applied to the complete loaded branch.

The compact indicator in the bottom-right corner shows how many messages are displayed and hidden. Disabling optimization restores messages hidden by the DOM fallback without losing their content.

## Export

Select **Export Conversation** in the main popup. The sidebar lets you:

- select every message, prompts only, or responses only;
- select individual messages and `Shift` ranges;
- include the title, conversation link, export date, timestamps, reasoning, and sources;
- save the conversation as `.md`, `.txt`, `.json`, or `.csv`;
- copy the generated output to the clipboard;
- prepare a PDF through Safari's standard system print dialog.

PDF output is generated locally. Choose **Save as PDF** in the macOS print dialog to save it.

## Privacy

The extension requests only:

- `storage` for local interface and export settings;
- access to `https://chatgpt.com/*` and `https://chat.openai.com/*` so it can operate inside the open ChatGPT tab.

Conversation content is never sent to the developer or a third-party service. Markdown, TXT, JSON, and CSV files are generated in the current tab. Temporary PDF job data is removed from local extension storage as soon as the print preview opens.

## Compatibility and limitations

- The target version is Safari 18 or later.
- ChatGPT's internal conversation endpoint and DOM are not public APIs and may change.
- Optimization and complete export should be retested after major ChatGPT updates.
- Private Browsing and separate Safari profiles may require their own extension permissions.

Version `2.0.2` was tested on August 21, 2026 in an authenticated Safari session. With the status showing `10 shown / 2 hidden`, the exporter still received all 12 original messages. Direct number entry, the `1–20` and `1–100` ranges, individual selection, and export options were also verified.

## Development

Automated verification requires Node.js 20 or later. The project has no external npm dependencies.

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools
npm run verify
```

This command validates the manifest, resource paths, CSP, and JavaScript syntax, then runs 25 tests covering optimization and export behavior.

### Project structure

```text
Extension/
├── content/    # DOM optimization, status indicator, and exporter
├── icons/      # Safari icon set
├── popup/      # main extension popup
├── print/      # local PDF and print preview
└── scripts/    # page-world interceptor and trimming algorithm

Design/         # editable SVG icon source
tests/          # unit tests that do not require Safari
tools/          # static extension validation
```

Technical notes:

- [Chromium-to-Safari porting notes](PORTING_NOTES.md);
- [exporter integration notes](EXPORTER_PORTING_NOTES.md);
- [performance research](PERFORMANCE_RESEARCH.md);
- [changelog](CHANGELOG.md).

If a ChatGPT update changes the extension's behavior, [open an issue](https://github.com/galetaa/chat-gpt-tools/issues/new) and include your macOS, Safari, and extension versions.

---

<p align="center">
  Built for fast, long conversations — without compromising privacy.
</p>
