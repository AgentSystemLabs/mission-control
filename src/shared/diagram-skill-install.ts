export const DIAGRAM_SKILL_INSTALL_TARGETS = {
  claude: {
    label: "Claude Code",
    segments: [".claude", "skills", "diagram"] as const,
  },
  codex: {
    label: "Codex",
    segments: [".codex", "skills", "diagram"] as const,
  },
  cursor: {
    label: "Cursor CLI",
    segments: [".cursor", "skills", "diagram"] as const,
  },
} as const;

export type DiagramSkillHarness = keyof typeof DIAGRAM_SKILL_INSTALL_TARGETS;

export type DiagramSkillHarnessSelection = Record<DiagramSkillHarness, boolean>;

export type DiagramSkillInstallResult = {
  [K in DiagramSkillHarness as `${K}Installed`]: boolean;
};

export const DIAGRAM_SKILL_HARNESS_KEYS = Object.keys(
  DIAGRAM_SKILL_INSTALL_TARGETS,
) as DiagramSkillHarness[];

export function diagramSkillInstallPath(harness: DiagramSkillHarness): string {
  return DIAGRAM_SKILL_INSTALL_TARGETS[harness].segments.join("/") + "/";
}

export function emptyDiagramSkillHarnessSelection(): DiagramSkillHarnessSelection {
  return { claude: false, codex: false, cursor: false };
}

export function allDiagramSkillHarnessesSelected(): DiagramSkillHarnessSelection {
  return { claude: true, codex: true, cursor: true };
}

export function hasDiagramSkillHarnessSelection(
  harnesses: DiagramSkillHarnessSelection,
): boolean {
  return DIAGRAM_SKILL_HARNESS_KEYS.some((key) => harnesses[key]);
}

export function installedDiagramSkillHarnessLabels(
  installed: DiagramSkillInstallResult,
): string[] {
  return DIAGRAM_SKILL_HARNESS_KEYS.filter(
    (key) => installed[`${key}Installed`],
  ).map((key) => DIAGRAM_SKILL_INSTALL_TARGETS[key].label);
}
