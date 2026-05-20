export const featureFlags = {
  installSkillsButton: false,
  worktrees: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
