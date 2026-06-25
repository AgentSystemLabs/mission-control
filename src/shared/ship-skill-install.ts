export const SHIP_SKILL_MARKER = "ship";

export const SHIP_SKILL_INSTALL_TARGETS = {
  claude: {
    label: "Claude Code",
    skillSegments: [".claude", "skills"] as const,
    agentSegments: [".claude", "agents"] as const,
    agentExtension: ".md" as const,
  },
  codex: {
    label: "Codex",
    skillSegments: [".codex", "skills"] as const,
    agentSegments: [".codex", "agents"] as const,
    agentExtension: ".toml" as const,
  },
  cursor: {
    label: "Cursor CLI",
    skillSegments: [".cursor", "skills"] as const,
    agentSegments: [".cursor", "agents"] as const,
    agentExtension: ".md" as const,
    altSkillSegments: [".agents", "skills"] as const,
  },
} as const;

export type ShipSkillHarness = keyof typeof SHIP_SKILL_INSTALL_TARGETS;

export type ShipSkillHarnessSelection = Record<ShipSkillHarness, boolean>;

export type ShipSkillInstallResult = {
  [K in ShipSkillHarness as `${K}Installed`]: boolean;
} & {
  skillsInstalled: number;
  agentsInstalled: number;
};

export const SHIP_SKILL_HARNESS_KEYS = Object.keys(
  SHIP_SKILL_INSTALL_TARGETS,
) as ShipSkillHarness[];

export function shipSkillInstallPath(harness: ShipSkillHarness): string {
  const target = SHIP_SKILL_INSTALL_TARGETS[harness];
  const skillPath = target.skillSegments.join("/");
  const agentPath = target.agentSegments.join("/");
  return `${skillPath}/* and ${agentPath}/*`;
}

export function emptyShipSkillHarnessSelection(): ShipSkillHarnessSelection {
  return { claude: false, codex: false, cursor: false };
}

export function allShipSkillHarnessesSelected(): ShipSkillHarnessSelection {
  return { claude: true, codex: true, cursor: true };
}

export function selectedShipSkillHarnesses(
  harnesses: ShipSkillHarnessSelection,
): ShipSkillHarness[] {
  return SHIP_SKILL_HARNESS_KEYS.filter((key) => harnesses[key]);
}

export function shipSkillInstallCommand(harnesses: ShipSkillHarnessSelection): string {
  return selectedShipSkillHarnesses(harnesses)
    .map((harness) => `npx --yes @agentsystemlabs/core init --harness ${harness} --force`)
    .join(" && ");
}

export function hasShipSkillHarnessSelection(
  harnesses: ShipSkillHarnessSelection,
): boolean {
  return selectedShipSkillHarnesses(harnesses).length > 0;
}

export function installedShipSkillHarnessLabels(
  installed: ShipSkillInstallResult,
): string[] {
  return SHIP_SKILL_HARNESS_KEYS.filter(
    (key) => installed[`${key}Installed`],
  ).map((key) => SHIP_SKILL_INSTALL_TARGETS[key].label);
}
