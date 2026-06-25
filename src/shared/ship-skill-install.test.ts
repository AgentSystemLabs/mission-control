import { describe, expect, it } from "vitest";
import {
  selectedShipSkillHarnesses,
  shipSkillInstallCommand,
} from "./ship-skill-install";

describe("ship skill install command", () => {
  it("builds agentsystem init commands for selected harnesses", () => {
    const selection = { claude: true, codex: false, cursor: true };

    expect(selectedShipSkillHarnesses(selection)).toEqual(["claude", "cursor"]);
    expect(shipSkillInstallCommand(selection)).toBe(
      "npx --yes @agentsystemlabs/core init --harness claude --force && " +
        "npx --yes @agentsystemlabs/core init --harness cursor --force",
    );
  });
});
