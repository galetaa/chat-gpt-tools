# ChatGPT layout compatibility - v2.1.3

Prepared for release v2.1.3 on 2026-10-01 for Safari and Chromium.

## Evidence

The authenticated ChatGPT page in Thorium displayed the conversation while the
extension remained at “Waiting for conversation”. DevTools Elements found zero
`[data-message-id]` elements. The page exposed
`data-history-streaming-enabled="true"` and the new app shell with active and
inactive page containers.

The stylesheet loaded by that page,
https://chatgpt.com/cdn/assets/886701.3eeec92024.css, contains semantic selectors
`[data-markdown-text-tone=user-message]`,
`[data-markdown-text-style=assistant-message]`, and
`[data-virtualized-turn-content]`. These markers inform the new DOM adapter;
their exact nesting in the authenticated conversation still needs runtime QA.
Browser automation became unavailable after the session server restarted.

## Changes

- Share message discovery between DOM trimming and DOM export, supporting both
  classic role attributes and the new Markdown markers.
- Support exact `conversation-turn` test IDs as well as numbered IDs.
- Exclude inactive app-shell pages and exporter previews; deduplicate nested
  markers and combine multiple content blocks inside a single-role turn.
- Keep prompt and response independently trimmable when a virtualized container
  contains both roles. Observe semantic attribute changes and late insertion of
  content into existing turns. Clear stale trim markers when containers change.
- Recognize new user-message content when collapsing long prompts.
- Resolve a failed full-conversation bridge request with a null payload instead
  of unnecessarily waiting for the content-side timeout.

## Verification and remaining scope

`npm run verify` validates manifests, syntax, shared Chromium files and the test
suite. Regression fixtures cover the new markers, classic layout, mixed-role
virtualized containers, inactive pages, late content and DOM export of hidden
messages. These are synthetic fixtures, not a captured full live DOM.

The JSON conversation interceptor remains unchanged. The new streaming history
protocol has not been captured or implemented. When the existing full-history
API is unavailable, the exporter uses messages currently mounted in the DOM
(including those hidden by this extension), labelled “Loaded chat”. Messages
unmounted by ChatGPT virtualization are not recovered by this fallback.

For manual testing, reload the unpacked extension from `Build/ChromiumExtension`
and then reload ChatGPT. Check limits down/up, optimization off/on, export of
both roles and hidden messages, SPA navigation, and a new streamed response.

## Follow-up: plain user prompts

Live Elements inspection confirmed a user wrapper with
`data-chatgpt-search-unit-key="fallback-turn-0:0:user"`,
`data-chatgpt-search-message-ids`, and a nested
`data-user-message-bubble="true"`. Plain prompts do not necessarily have the
Markdown tone marker used by the first compatibility build.

The adapter now recognizes both the user search-unit wrapper and standalone
user bubbles, deduplicates nested markers, and exports the bubble contents.
Regression tests verify that two prompts plus two responses count as four,
that a limit of three hides only the first prompt, that a limit of one hides
both prompts and the first response, and that export retains all four messages.
All 37 tests pass. Safari and Chromium packages include this follow-up.
