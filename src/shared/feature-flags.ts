export const featureFlags = {
  installSkillsButton: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
