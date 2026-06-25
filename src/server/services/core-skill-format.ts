import * as fs from "node:fs";

const MAX_CODEX_DESCRIPTION_LENGTH = 1024;

function splitFrontmatter(content: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) return null;

  return {
    frontmatterLines: lines.slice(1, endIndex),
    body: lines.slice(endIndex + 1).join("\n"),
  };
}

function readScalar(lines: string[], key: string): string | null {
  const prefix = `${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) return null;

  let value = line.slice(prefix.length).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function truncateDescription(description: string): string {
  if (description.length <= MAX_CODEX_DESCRIPTION_LENGTH) return description;

  const suffix = "...";
  const limit = MAX_CODEX_DESCRIPTION_LENGTH - suffix.length;
  const truncated = description.slice(0, limit);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 800) return truncated.slice(0, lastSpace) + suffix;
  return truncated + suffix;
}

export function normalizeCodexSkill(skillFile: string, fallbackName: string): void {
  const content = fs.readFileSync(skillFile, "utf-8");
  const parsed = splitFrontmatter(content);
  if (!parsed) return;

  const name = readScalar(parsed.frontmatterLines, "name") || fallbackName;
  const rawDescription =
    readScalar(parsed.frontmatterLines, "description") || `AgentSystem skill: ${name}`;
  const description = truncateDescription(rawDescription);

  const frontmatter = [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(skillFile, frontmatter + parsed.body, "utf-8");
}

function tomlMultilineString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  return `"""\n${escaped}\n"""`;
}

export function convertAgentToCodexToml(
  agentMdFile: string,
  outTomlFile: string,
  fallbackName: string,
): void {
  const content = fs.readFileSync(agentMdFile, "utf-8");
  const parsed = splitFrontmatter(content);

  let name = fallbackName;
  let description = `AgentSystem subagent: ${fallbackName}`;
  let body = content;

  if (parsed) {
    name = readScalar(parsed.frontmatterLines, "name") || fallbackName;
    description = truncateDescription(
      readScalar(parsed.frontmatterLines, "description") ||
        `AgentSystem subagent: ${name}`,
    );
    body = parsed.body.replace(/^\n+/, "");
  }

  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${tomlMultilineString(body)}`,
    "",
  ];

  fs.writeFileSync(outTomlFile, lines.join("\n"), "utf-8");
}
