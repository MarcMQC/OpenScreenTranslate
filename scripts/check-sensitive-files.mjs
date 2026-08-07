import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const excludedDirectories = new Set([".git", "dist", "node_modules", "target"]);
const binaryExtensions = new Set([
  ".icns",
  ".ico",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const sensitiveExtensions = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".keystore",
  ".mobileprovision",
  ".p12",
  ".p8",
  ".pem",
  ".pfx",
]);
const secretPatterns = [
  ["AWS access key", new RegExp("A" + "KIA[0-9A-Z]{16}")],
  ["AWS temporary access key", new RegExp("A" + "SIA[0-9A-Z]{16}")],
  ["GitHub fine-grained token", new RegExp("github" + "_pat_[A-Za-z0-9_]{20,}")],
  ["GitHub token", new RegExp("gh" + "[pousr]_[A-Za-z0-9]{20,}")],
  ["Anthropic API Key", new RegExp("sk" + "-ant-[A-Za-z0-9_-]{16,}")],
  ["AI provider API Key", new RegExp("sk" + "-[A-Za-z0-9]{20,}")],
  ["Google API Key", new RegExp("AI" + "za[0-9A-Za-z_-]{30,}")],
  ["private key", new RegExp("-----BEGIN (?:[A-Z ]+ )?PRIVATE " + "KEY-----")],
];

const findings = [];

function relativePath(path) {
  return relative(projectRoot, path) || ".";
}

function inspectFile(path, name) {
  const normalizedName = name.toLowerCase();
  const extension = extname(normalizedName);
  const relativeName = relativePath(path);

  if (name === ".DS_Store") {
    findings.push([relativeName, "Finder metadata"]);
  }
  if (
    (normalizedName === ".env" || normalizedName.startsWith(".env.")) &&
    normalizedName !== ".env.example"
  ) {
    findings.push([relativeName, "environment file"]);
  }
  if (sensitiveExtensions.has(extension)) {
    findings.push([relativeName, `credential or signing file (${extension})`]);
  }

  if (binaryExtensions.has(extension)) return;

  const contents = readFileSync(path);
  if (contents.includes(0)) return;
  const text = contents.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push([relativeName, label]);
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) inspectFile(path, entry.name);
  }
}

walk(projectRoot);

if (findings.length > 0) {
  console.error("Potential sensitive files or secrets detected:");
  for (const [path, label] of findings) console.error(`- ${path}: ${label}`);
  console.error("Remove or redact these items before committing.");
  process.exit(1);
}

console.log("No high-confidence secrets or sensitive files detected.");
