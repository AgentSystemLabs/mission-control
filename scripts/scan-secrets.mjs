import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const patterns = [
  {
    name: "private key",
    re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: "aws access key",
    re: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: "github token",
    re: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  },
  {
    name: "stripe live secret",
    re: /sk_live_[A-Za-z0-9]{20,}/g,
  },
  {
    name: "stripe webhook secret",
    re: /whsec_[A-Za-z0-9]{20,}/g,
  },
  {
    name: "openai api key",
    re: /sk-[A-Za-z0-9_-]{32,}/g,
  },
  {
    name: "google api key",
    re: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: "slack token",
    re: /xox[baprs]-[A-Za-z0-9-]{20,}/g,
  },
];

const ignoredPathParts = [
  "/.git/",
  "/dist/",
  "/dist-server/",
  "/dist-electron/",
  "/dist-electron-out/",
  "/node_modules/",
  "/test-results/",
];

function gitFiles(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function allCandidateFiles() {
  return [...new Set([
    ...gitFiles(["ls-files"]),
    ...gitFiles(["ls-files", "--others", "--exclude-standard"]),
  ])].filter((file) => {
    const normalized = `/${file}`;
    return !ignoredPathParts.some((part) => normalized.includes(part));
  });
}

function isText(buffer) {
  return !buffer.includes(0);
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const findings = [];

for (const file of allCandidateFiles()) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
  const buffer = readFileSync(file);
  if (!isText(buffer)) continue;
  const text = buffer.toString("utf8");
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    for (const match of text.matchAll(pattern.re)) {
      findings.push({
        file,
        line: lineNumber(text, match.index ?? 0),
        name: pattern.name,
      });
    }
  }
}

if (findings.length) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.name}`);
  }
  process.exit(1);
}

console.log("No obvious secrets found.");
