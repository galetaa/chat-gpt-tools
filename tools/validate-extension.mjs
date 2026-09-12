import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const safariRoot = path.join(projectRoot, "Extension");
const chromiumRoot = path.join(projectRoot, "Build", "ChromiumExtension");
const chromiumManifestSource = path.join(
  projectRoot,
  "platforms",
  "chromium",
  "manifest.json"
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);

async function readManifest(extensionRoot) {
  return JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
}

const safariManifest = await readManifest(safariRoot);
const chromiumManifest = await readManifest(chromiumRoot);
const expectedChromiumManifest = JSON.parse(
  await readFile(chromiumManifestSource, "utf8")
);

assert.deepEqual(
  chromiumManifest,
  expectedChromiumManifest,
  "The generated Chromium manifest must match its platform source"
);

function validatePlatformManifest(manifest, platform) {
  assert.equal(manifest.manifest_version, 3, `${platform}: Manifest V3 is required`);
  assert.equal(typeof manifest.name, "string", `${platform}: name is required`);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    manifest.version,
    packageJson.version,
    `${platform}: manifest and package versions must match`
  );
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ]);
  assert.equal(manifest.content_scripts[0].world, "MAIN");
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  assert.equal(manifest.content_scripts[1].run_at, "document_start");

  for (const forbiddenKey of ["key", "update_url"]) {
    assert.equal(
      Object.hasOwn(manifest, forbiddenKey),
      false,
      `${platform}: ${forbiddenKey} must not be committed`
    );
  }
}

validatePlatformManifest(safariManifest, "Safari");
validatePlatformManifest(chromiumManifest, "Chromium");

assert.match(safariManifest.name, /Safari/);
assert.equal(Object.hasOwn(safariManifest, "minimum_chrome_version"), false);
assert.match(chromiumManifest.name, /Chromium/);
assert.equal(chromiumManifest.short_name.length <= 12, true);
assert.equal(chromiumManifest.description.length <= 132, true);
assert.equal(
  Number.parseInt(chromiumManifest.minimum_chrome_version, 10) >= 111,
  true,
  "Chromium must require a version that supports static MAIN-world scripts"
);
assert.equal(
  chromiumManifest.homepage_url,
  "https://github.com/galetaa/chat-gpt-tools"
);

async function validatePngIcon(extensionRoot, size, relativePath) {
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

function collectManifestResources(manifest) {
  const referencedFiles = new Set();
  const addReference = (value) => {
    if (typeof value === "string" && value.length > 0) {
      referencedFiles.add(value);
    }
  };

  Object.values(manifest.icons || {}).forEach(addReference);
  addReference(manifest.action?.default_popup);
  Object.values(manifest.action?.default_icon || {}).forEach(addReference);
  for (const contentScript of manifest.content_scripts || []) {
    (contentScript.js || []).forEach(addReference);
    (contentScript.css || []).forEach(addReference);
  }
  for (const resourceGroup of manifest.web_accessible_resources || []) {
    (resourceGroup.resources || []).forEach(addReference);
  }
  return referencedFiles;
}

async function validateManifestResources(extensionRoot, manifest, platform) {
  const referencedFiles = collectManifestResources(manifest);
  for (const relativePath of referencedFiles) {
    const absolutePath = path.join(extensionRoot, relativePath);
    assert.equal(
      absolutePath.startsWith(`${extensionRoot}${path.sep}`),
      true,
      `${platform}: manifest path escapes the extension root: ${relativePath}`
    );
    await access(absolutePath);
  }

  for (const [size, relativePath] of Object.entries(manifest.icons || {})) {
    await validatePngIcon(extensionRoot, size, relativePath);
  }
  for (const [size, relativePath] of Object.entries(
    manifest.action?.default_icon || {}
  )) {
    await validatePngIcon(extensionRoot, size, relativePath);
  }
  return referencedFiles.size;
}

const safariResourceCount = await validateManifestResources(
  safariRoot,
  safariManifest,
  "Safari"
);
const chromiumResourceCount = await validateManifestResources(
  chromiumRoot,
  chromiumManifest,
  "Chromium"
);

async function listFiles(root, relativeDirectory = "") {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

const sharedFiles = (await listFiles(safariRoot)).filter(
  (relativePath) => relativePath !== "manifest.json"
);
const chromiumFiles = (await listFiles(chromiumRoot)).filter(
  (relativePath) => relativePath !== "manifest.json"
);
assert.deepEqual(
  chromiumFiles,
  sharedFiles,
  "Chromium build must contain every shared extension file"
);
for (const relativePath of sharedFiles) {
  const [sharedContents, chromiumContents] = await Promise.all([
    readFile(path.join(safariRoot, relativePath)),
    readFile(path.join(chromiumRoot, relativePath))
  ]);
  assert.equal(
    sharedContents.equals(chromiumContents),
    true,
    `Chromium build differs from shared source: ${relativePath}`
  );
}

async function validateExtensionPages(extensionRoot, manifest, platform) {
  const popupPath = path.join(extensionRoot, manifest.action.default_popup);
  const popupHtml = await readFile(popupPath, "utf8");
  assert.equal(/<script[^>]+src=["']https?:/i.test(popupHtml), false);
  assert.equal(/<script(?![^>]+src=)/i.test(popupHtml), false);
  assert.match(popupHtml, /id="keepSlider"[^>]+max="20"/s);
  assert.match(popupHtml, /id="extendedRangeToggle"/);
  assert.match(popupHtml, /id="platformBadge"/);
  assert.match(popupHtml, /type="number"[^>]+id="keepValueInput"[^>]+max="20"/s);
  assert.equal(popupHtml.includes("compactNowButton"), false);
  assert.match(popupHtml, /id="exportConversationButton"/);
  assert.equal((popupHtml.match(/\bswitch\b/g) || []).length >= 4, true);

  const popupDirectory = path.dirname(manifest.action.default_popup);
  for (const match of popupHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const scriptPath = path.normalize(path.join(popupDirectory, match[1]));
    await access(path.join(extensionRoot, scriptPath));
  }

  const printHtml = await readFile(path.join(extensionRoot, "print/print.html"), "utf8");
  assert.equal(/<script[^>]+src=["']https?:/i.test(printHtml), false);
  assert.equal(/<script(?![^>]+src=)/i.test(printHtml), false);
  assert.match(printHtml, /browser’s print dialog/);

  const csp = manifest.content_security_policy?.extension_pages || "";
  assert.match(csp, /script-src 'self'/);
  assert.equal(csp.includes("unsafe-eval"), false);
  assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false);

  const popupCss = await readFile(path.join(extensionRoot, "popup/popup.css"), "utf8");
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
    `${platform}: popup width must not depend on a narrow initial viewport`
  );
}

await validateExtensionPages(safariRoot, safariManifest, "Safari");
await validateExtensionPages(chromiumRoot, chromiumManifest, "Chromium");

const source = async (relativePath) => readFile(path.join(safariRoot, relativePath), "utf8");
const collapseScript = await source("content/user-message-collapse.js");
const exporterScript = await source("content/exporter.js");
const contentScript = await source("content/content.js");
const statusScript = await source("content/status-bar.js");
const collapseCss = await source("content/user-message-collapse.css");
const pageScript = await source("scripts/page-script.js");
const trimCore = await source("scripts/trim-core.js");
const popupScript = await source("popup/popup.js");

assert.match(exporterScript, /\/backend-api\/conversation\//);
assert.match(exporterScript, /chatgpt-tools-request-conversation/);
assert.match(exporterScript, /role="list"/);
assert.equal(exporterScript.includes('role="listbox"'), false);
assert.equal(exporterScript.includes("ct-message-expand"), false);
assert.equal(exporterScript.includes("chatgptexporter.com"), false);
assert.match(contentScript, /chatgpt-tools:open-exporter/);
assert.match(contentScript, /sendResponse\?\.\(\{ ok: true \}\)/);
assert.equal(contentScript.includes("Promise.resolve({ ok: true })"), false);
assert.match(statusScript, /shown/);
assert.match(statusScript, /hidden/);
assert.equal(statusScript.includes("ct-status-brand"), false);
assert.equal(statusScript.includes("ct-status-mark"), false);
assert.equal(collapseScript.includes("characterData: true"), false);
assert.match(collapseCss, /data-ls-uc-state="collapsed"[^}]*contain:\s*paint/s);
assert.match(pageScript, /__CHATGPT_TOOLS_FETCH_PATCHED__/);
assert.match(trimCore, /__CHATGPT_TOOLS_TRIM_CORE__/);
assert.equal(pageScript.includes("LIGHT_SESSION_SAFARI"), false);
assert.equal(pageScript.includes("lightsession-"), false);
assert.equal(contentScript.includes("LightSession"), false);
assert.match(popupScript, /manifest\.name\?\.includes\("Chromium"\)/);

console.log(
  `Validated Safari (${safariResourceCount} resources) and Chromium ` +
  `(${chromiumResourceCount} resources) builds, shared files, popup sizing, and CSP.`
);
