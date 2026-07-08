# Product

## Register

product

## Users

Solo developers and small teams running multiple AI coding agents (Claude Code, Codex, Cursor CLI) across 5+ git repos a day. They live in the app for hours: dense terminal grids, quick context switches, keyboard-first. Ambient light varies but sessions are long — dark mode is the primary surface.

## Product Purpose

Mission Control is an Electron desktop control surface for agentic coding work. It shows at a glance which projects/sessions need attention and lets the user pop into a project to drive its agents — a grid of live terminal sessions instead of a cluttered sidebar. Success = the tool disappears into the task; status is legible at a glance; nothing steals attention from the terminals.

## Brand Personality

Calm, precise, operator-grade. A cockpit, not a dashboard-as-marketing. Confidence through restraint: the terminals are the content, chrome is quiet.

## Anti-references

- Cursor/Codex collapsible-tree sidebar clutter.
- SaaS-dashboard gloss: gradient heroes, glassmorphism, decorative motion.
- Over-bordered "wireframe" look where every panel is outlined and chrome competes with terminal content.

## Design Principles

1. **Terminals are the content** — chrome recedes; hierarchy comes from surface tone and spacing before borders.
2. **State is always legible** — running / needs-input / done must read at a glance; accent color is reserved for state and selection.
3. **Feedback on every interaction** — everything clickable acknowledges hover and press within ~150ms; motion conveys state, never decorates.
4. **Density with rhythm** — the app is dense by design; use spacing and tonal steps, not extra boxes, to organize it.
5. **Consistent vocabulary** — same button/pane/control grammar across painted and flat themes, dark and light.

## Accessibility & Inclusion

- Body/label text ≥ 4.5:1 against its surface; state pills ≥ 3:1.
- Full `prefers-reduced-motion` support — all micro-interactions degrade to instant or crossfade.
- Keyboard focus visible on every interactive element (focus ring distinct from hover).
