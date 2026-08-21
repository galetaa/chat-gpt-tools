import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(projectRoot, "Extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);

assert.equal(manifest.manifest_version, 3, "Manifest V3 is required");
assert.equal(typeof manifest.name, "string");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(
  manifest.version,
  packageJson.version,
  "Manifest and package versions must match"
);

for (const chromiumOnlyKey of ["key", "update_url"]) {
  assert.equal(
    Object.hasOwn(manifest, chromiumOnlyKey),
    false,
    `${chromiumOnlyKey} must not be present in the Safari manifest`
  );
}

assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*"
]);
assert.equal(manifest.content_scripts[0].world, "MAIN");
assert.equal(manifest.content_scripts[0].run_at, "document_start");

const referencedFiles = new Set();

async function validatePngIcon(size, relativePath) {
  const expectedSize = Number.parseInt(size, 10);
  const contents = await readFile(path.join(extensionRoot, relativePath));
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    `${relativePath} must be a PNG`
  );
  assert.equal(contents.readUInt32BE(16), expectedSize, `${relativePath} width`);
  assert.equal(contents.readUInt32BE(20), expectedSize, `${relativePath} height`);
  assert.equal(
    contents[25],
    6,
    `${relativePath} must retain RGBA transparency for rounded corners`
  );
}

function addReference(value) {
  if (typeof value === "string" && value.length > 0) {
    referencedFiles.add(value);
  }
}

Object.values(manifest.icons || {}).forEach(addReference);
addReference(manifest.action?.default_popup);
Object.values(manifest.action?.default_icon || {}).forEach(addReference);

for (const [size, relativePath] of Object.entries(manifest.icons || {})) {
  await validatePngIcon(size, relativePath);
}
for (const [size, relativePath] of Object.entries(
  manifest.action?.default_icon || {}
)) {
  await validatePngIcon(size, relativePath);
}

for (const contentScript of manifest.content_scripts || []) {
  (contentScript.js || []).forEach(addReference);
  (contentScript.css || []).forEach(addReference);
}
for (const resourceGroup of manifest.web_accessible_resources || []) {
  (resourceGroup.resources || []).forEach(addReference);
}

for (const relativePath of referencedFiles) {
  const absolutePath = path.join(extensionRoot, relativePath);
  assert.equal(
    absolutePath.startsWith(`${extensionRoot}${path.sep}`),
    true,
    `Manifest path escapes the extension root: ${relativePath}`
  );
  await access(absolutePath);
}

const popupHtml = await readFile(
  path.join(extensionRoot, manifest.action.default_popup),
  "utf8"
);
assert.equal(/<script[^>]+src=["']https?:/i.test(popupHtml), false);
assert.equal(/<script(?![^>]+src=)/i.test(popupHtml), false);
assert.match(popupHtml, /id="keepSlider"[^>]+max="20"/s);
assert.match(popupHtml, /id="extendedRangeToggle"/);
assert.match(popupHtml, /type="number"[^>]+id="keepValueInput"[^>]+max="20"/s);
assert.equal(popupHtml.includes("compactNowButton"), false);
assert.match(popupHtml, /id="exportConversationButton"/);
assert.equal((popupHtml.match(/\bswitch\b/g) || []).length >= 4, true);

const popupCss = await readFile(
  path.join(extensionRoot, "popup/popup.css"),
  "utf8"
);
assert.match(popupCss, /body\s*\{[^}]*width:\s*360px;/s);
assert.match(popupCss, /body\s*\{[^}]*min-width:\s*360px;/s);
assert.match(popupCss, /body\s*\{[^}]*max-width:\s*360px;/s);
assert.match(popupCss, /\.ls-switch\s*\{[^}]*appearance:\s*none;/s);
assert.match(
  popupCss,
  /\.ls-tool-button\s*\{[^}]*background:\s*transparent\s*!important;/s
);
assert.equal(
  /body\s*\{[^}]*max-width:\s*100vw;/s.test(popupCss),
  false,
  "Safari popup width must not depend on its narrow initial viewport"
);

const collapseScript = await readFile(
  path.join(extensionRoot, "content/user-message-collapse.js"),
  "utf8"
);

const exporterScript = await readFile(
  path.join(extensionRoot, "content/exporter.js"),
  "utf8"
);
assert.match(exporterScript, /\/backend-api\/conversation\//);
assert.match(exporterScript, /chatgpt-tools-request-conversation/);
assert.match(exporterScript, /role="list"/);
assert.equal(exporterScript.includes('role="listbox"'), false);
assert.equal(exporterScript.includes("ct-message-expand"), false);
assert.equal(exporterScript.includes("chatgptexporter.com"), false);

const contentScript = await readFile(
  path.join(extensionRoot, "content/content.js"),
  "utf8"
);
assert.match(contentScript, /chatgpt-tools:open-exporter/);

const printHtml = await readFile(
  path.join(extensionRoot, "print/print.html"),
  "utf8"
);
assert.equal(/<script[^>]+src=["']https?:/i.test(printHtml), false);
assert.equal(/<script(?![^>]+src=)/i.test(printHtml), false);

const statusScript = await readFile(
  path.join(extensionRoot, "content/status-bar.js"),
  "utf8"
);
assert.match(statusScript, /shown/);
assert.match(statusScript, /hidden/);
assert.equal(statusScript.includes("ct-status-brand"), false);
assert.equal(statusScript.includes("ct-status-mark"), false);
assert.equal(
  collapseScript.includes("characterData: true"),
  false,
  "The collapse observer must not wake for every streamed text token"
);

const collapseCss = await readFile(
  path.join(extensionRoot, "content/user-message-collapse.css"),
  "utf8"
);
assert.match(
  collapseCss,
  /data-ls-uc-state="collapsed"[^}]*contain:\s*paint/s
);

const popupDirectory = path.dirname(manifest.action.default_popup);
for (const match of popupHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
  const scriptPath = path.normalize(path.join(popupDirectory, match[1]));
  await access(path.join(extensionRoot, scriptPath));
}

const csp = manifest.content_security_policy?.extension_pages || "";
assert.match(csp, /script-src 'self'/);
assert.equal(csp.includes("unsafe-eval"), false);
assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false);

console.log(
  `Validated ${referencedFiles.size} manifest resources, popup sizing, and CSP.`
);
