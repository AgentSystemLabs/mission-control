/**
 * Shared z-index tiers. `popover` is the topmost tier — floating menus,
 * dropdowns, and typeaheads rendered in portals that must sit above all
 * in-page chrome.
 */
export const Z_INDEX = {
  popover: 10000,
} as const;
