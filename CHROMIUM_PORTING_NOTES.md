# Chromium adaptation notes

## Scope

Version 2.1.0 adds a dedicated Chromium build while keeping the Safari extension on the same implementation. The Chromium package includes the conversation-response optimizer, reversible DOM fallback, compact status indicator, long-prompt collapsing, full conversation selection, Markdown/TXT/JSON/CSV export, clipboard output, and local PDF print preview.

The build targets current desktop Chromium browsers, including Google Chrome, Chromium, Microsoft Edge, Brave, and Vivaldi. Chrome is the primary validation target.

## Source and build layout

`Extension/` remains the single source for JavaScript, HTML, CSS, and icons. It also contains the Safari manifest used by Xcode. `platforms/chromium/manifest.json` is the Chromium-specific manifest overlay.

`npm run build:chromium` copies the shared source to `Build/ChromiumExtension/` and replaces only the manifest. The validator then compares every non-manifest file byte for byte, preventing either browser build from silently losing a feature.

This avoids maintaining two divergent copies of the optimizer and exporter.

## Manifest V3 and execution worlds

The optimizer must wrap the page's `fetch` before ChatGPT loads a conversation. Both builds therefore declare the trimming core and interceptor as static `document_start` content scripts in the `MAIN` execution world. The settings, DOM fallback, status, and exporter run in the default isolated world.

Chromium support starts at version 111 because that is the first Chrome extension execution-world version used by this build. The manifest states this explicitly through `minimum_chrome_version` instead of failing unpredictably on older installations.

The page and isolated worlds exchange JSON strings through namespaced `CustomEvent` values. No page object or extension API handle crosses the boundary.

References:

- [Manifest content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Content-script execution worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Minimum Chrome version](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)

## Extension API compatibility

Shared extension contexts select `browser.*` when available and fall back to `chrome.*`. Promise-returning storage and tab operations are supported by the targeted Manifest V3 versions.

Message listeners are intentionally different: the exporter-open handler responds synchronously with the `sendResponse` callback instead of returning a Promise. That path works in older Chromium releases as well as Safari and avoids relying on Chrome 148's newer Promise-listener behavior.

The popup needs no `tabs` permission. The two narrow host permissions are sufficient to read a matching ChatGPT tab's URL and send a message to its already-declared content script. The Chromium manifest consequently requests only `storage` plus access to the two ChatGPT origins.

References:

- [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome tabs API permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## No service worker by design

The original Chromium optimizer contained a service worker, but its useful work was limited to setting defaults and relaying operations that current extension pages and content scripts already perform directly.

The combined extension does not need persistent or event-driven background behavior:

- settings live in `storage.local` and are normalized when read;
- the toolbar popup talks directly to the active ChatGPT content script;
- downloads are created locally from a user-initiated Blob URL;
- PDF jobs use a short-lived extension page and are removed immediately after opening;
- no remote calls, alarms, context menus, or cross-origin background fetches are required.

Omitting a worker reduces idle overhead and removes another lifecycle boundary without dropping functionality.

## Security and privacy

The Chromium manifest intentionally excludes:

- `key` and `update_url` copied from store-installed extensions;
- `<all_urls>`, `tabs`, `downloads`, `scripting`, and `webRequest` permissions;
- remote scripts and unsafe evaluation;
- externally connectable websites;
- the original exporter's remote backend and PDF endpoint.

The extension CSP permits only packaged scripts. Inline styles remain allowed because the local PDF page generates its `@page` size and margins from normalized settings; inline and evaluated scripts remain blocked.

The full conversation snapshot is serialized to an in-memory Blob before the UI receives its trimmed response. It is not written to extension storage and is released when the tab navigates to another conversation. Only the short-lived PDF job is placed in extension storage, then deleted as soon as the print page reads it.

## Chromium-specific user experience

The popup reads its platform name from the active manifest, so the same markup displays a `Chromium` badge in the generated build and `Safari` in the Safari build. Browser-specific error messages and print instructions were replaced with neutral wording.

The custom switches, slider, responsive export panel, light/dark appearance, reduced-motion mode, high-contrast mode, keyboard focus, and semantic list roles work without a browser-specific UI framework.

## Packaging and validation

Run:

```sh
npm run verify
npm run package:chromium
```

The verification pipeline checks:

- manifest versions, names, permissions, hosts, CSP, and minimum Chromium version;
- every referenced JavaScript, CSS, HTML, and icon resource;
- exact PNG dimensions and alpha channels;
- byte-for-byte parity between shared files and the generated Chromium build;
- popup controls and safe external-script restrictions;
- cross-browser message-response behavior;
- syntax for both unpacked trees;
- optimizer, settings, DOM fallback, branch extraction, and exporter tests.

The release ZIP is assembled with `manifest.json` at its root, so users can extract it and select the resulting folder through Chromium's **Load unpacked** action.

On September 12, 2026, the generated 2.1.0 build was exercised in Thorium 138 with a temporary clean profile. The live engine loaded the unpacked extension, initialized storage, rendered the 360 px popup with the Chromium badge, persisted a custom limit, opened the exporter through `tabs.sendMessage`, trimmed a synthetic four-message conversation to two visible messages, returned the complete branch through the export bridge, updated the DOM status to `2 shown / 2 hidden`, rendered a local PDF job, and removed that job from storage. Google Chrome 152 also accepted the same build through its native extension packer.

## Remaining unstable boundaries

ChatGPT's `/backend-api/conversation/...` payload, `mapping/current_node` fields, and DOM selectors are implementation details rather than public APIs. The code fails open and falls back to the loaded DOM, but a major ChatGPT update can still reduce optimization or export coverage. Live tests should be repeated in Chromium and Safari after material site changes.
