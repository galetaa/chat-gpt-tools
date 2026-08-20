import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(projectRoot, "Extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert.equal(manifest.manifest_version, 3, "Manifest V3 is required");
assert.equal(typeof manifest.name, "string");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

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

function addReference(value) {
  if (typeof value === "string" && value.length > 0) {
    referencedFiles.add(value);
  }
}

Object.values(manifest.icons || {}).forEach(addReference);
addReference(manifest.action?.default_popup);
Object.values(manifest.action?.default_icon || {}).forEach(addReference);

for (const contentScript of manifest.content_scripts || []) {
  (contentScript.js || []).forEach(addReference);
  (contentScript.css || []).forEach(addReference);
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
assert.equal((popupHtml.match(/\bswitch\b/g) || []).length >= 4, true);

const popupCss = await readFile(
  path.join(extensionRoot, "popup/popup.css"),
  "utf8"
);
assert.match(popupCss, /body\s*\{[^}]*width:\s*360px;/s);
assert.match(popupCss, /body\s*\{[^}]*min-width:\s*360px;/s);
assert.match(popupCss, /body\s*\{[^}]*max-width:\s*360px;/s);
assert.equal(
  /body\s*\{[^}]*max-width:\s*100vw;/s.test(popupCss),
  false,
  "Safari popup width must not depend on its narrow initial viewport"
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
