export const DENSITY_VALUES = ["compact", "regular", "spacious"] as const;

export type Density = (typeof DENSITY_VALUES)[number];
