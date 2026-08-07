#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const checkOnly = process.argv.includes("--check");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const version = readFileSync(join(projectRoot, "VERSION"), "utf8").trim();

if (!semverPattern.test(version)) {
  throw new Error(`VERSION must contain a valid semantic version, received: ${version || "<empty>"}`);
}

const updates = [];

function updateTextFile(relativePath, transform) {
  const path = join(projectRoot, relativePath);
  const current = readFileSync(path, "utf8");
  const next = transform(current);
  if (next === current) return;
  updates.push(relativePath);
  if (!checkOnly) writeFileSync(path, next);
}

function updateJsonFile(relativePath, transform) {
  updateTextFile(relativePath, (current) => {
    const data = JSON.parse(current);
    transform(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });
}

updateJsonFile("package.json", (data) => {
  data.version = version;
});

updateJsonFile("package-lock.json", (data) => {
  data.version = version;
  if (!data.packages?.[""]) {
    throw new Error("package-lock.json is missing the root package entry");
  }
  data.packages[""].version = version;
});

updateJsonFile("src-tauri/tauri.conf.json", (data) => {
  data.version = version;
});

updateTextFile("src-tauri/Cargo.toml", (current) => {
  const pattern = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
  if (!pattern.test(current)) throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
  return current.replace(pattern, `$1${version}$2`);
});

updateTextFile("src-tauri/Cargo.lock", (current) => {
  const pattern = /(\[\[package\]\]\nname = "openscreentranslate"\nversion = ")[^"]+("\n)/;
  if (!pattern.test(current)) throw new Error("Could not find OpenScreenTranslate in src-tauri/Cargo.lock");
  return current.replace(pattern, `$1${version}$2`);
});

if (updates.length === 0) {
  console.log(`Version ${version} is synchronized.`);
} else if (checkOnly) {
  console.error(`Version ${version} is not synchronized in: ${updates.join(", ")}`);
  console.error("Run: npm run version:sync");
  process.exitCode = 1;
} else {
  console.log(`Synchronized version ${version} in: ${updates.join(", ")}`);
}
