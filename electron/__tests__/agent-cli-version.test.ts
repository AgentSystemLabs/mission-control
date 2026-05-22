import { describe, expect, it } from "vitest";
import {
  compareCliVersions,
  extractCliVersion,
} from "../agent-cli-version";
import { AGENT_CLI_VERSION_REQUIREMENTS } from "../agent-cli-version-requirements";

describe("agent CLI version helpers", () => {
  it("extracts versions from supported CLI outputs", () => {
    expect(extractCliVersion("codex 0.132.0")).toBe("0.132.0");
    expect(extractCliVersion("OpenAI Codex v0.132.0-alpha.1")).toBe("0.132.0-alpha.1");
    expect(extractCliVersion("2.1.146 (Claude Code)")).toBe("2.1.146");
    expect(extractCliVersion("2026.05.20-2b5dd59")).toBe("2026.05.20-2b5dd59");
  });

  it("compares semantic versions against configured minimums", () => {
    expect(compareCliVersions("0.131.9", AGENT_CLI_VERSION_REQUIREMENTS.codex.minimumVersion, "semver")).toBeLessThan(0);
    expect(compareCliVersions("0.132.0", AGENT_CLI_VERSION_REQUIREMENTS.codex.minimumVersion, "semver")).toBe(0);
    expect(compareCliVersions("2.1.145", AGENT_CLI_VERSION_REQUIREMENTS["claude-code"].minimumVersion, "semver")).toBeLessThan(0);
    expect(compareCliVersions("2.1.146", AGENT_CLI_VERSION_REQUIREMENTS["claude-code"].minimumVersion, "semver")).toBe(0);
  });

  it("compares Cursor calendar versions by date because the build hash is not orderable", () => {
    const cursorRequirement = AGENT_CLI_VERSION_REQUIREMENTS["cursor-cli"];

    expect(compareCliVersions("2026.05.19-abcdef0", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBeLessThan(0);
    expect(compareCliVersions("2026.05.20-abcdef0", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBe(0);
    expect(compareCliVersions("2026.05.21-0000000", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBeGreaterThan(0);
  });
});
