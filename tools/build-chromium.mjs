import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedExtensionRoot = path.join(projectRoot, "Extension");
const chromiumManifest = path.join(
  projectRoot,
  "platforms",
  "chromium",
  "manifest.json"
);
const outputRoot = path.join(projectRoot, "Build", "ChromiumExtension");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.dirname(outputRoot), { recursive: true });
await cp(sharedExtensionRoot, outputRoot, {
  recursive: true,
  filter(source) {
    return path.basename(source) !== ".DS_Store";
  }
});
await copyFile(chromiumManifest, path.join(outputRoot, "manifest.json"));

console.log(`Chromium extension built at ${outputRoot}`);
