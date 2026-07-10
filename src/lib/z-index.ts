/**
 * Shared z-index tiers. `popover` is the topmost interactive tier — floating
 * menus, dropdowns, and typeaheads rendered in portals that must sit above
 * all in-page chrome. `toast` sits above even that: notifications must stay
 * visible over full-screen overlays (settings) and modals. Pinned explicitly
 * on the sonner <Toaster> rather than trusting its built-in 999999999, which
 * could change across upgrades.
 */
export const Z_INDEX = {
  popover: 10000,
  toast: 20000,
} as const;
