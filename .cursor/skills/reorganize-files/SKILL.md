---
name: reorganize-files
description: >-
  Reorganize a directory of loose, ungrouped files (images dumped in public/,
  scripts piled in src/, assets at the root of a feature folder) into a clear
  grouped layout, then update every reference — imports, string paths, CSS
  url(), <img src>, OG/metadata tags, tsconfig aliases, and other configs — so
  builds and runtime URLs stay intact. Use when the user says "this folder is a
  mess", "organize this directory", "regroup these files", "tidy up public/",
  "group these images", "restructure assets/", "this folder needs structure",
  or points at a flat pile of files and asks for a better layout. Skip for:
  splitting an oversized single file (use file-modularity), pure renames
  without grouping (use a rename refactor), or removing dead files (use
  rip-out).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Regroup loose files into a coherent layout, fix every pointer

This skill targets one starting state: a directory where many files sit at the same level with no organizing scheme. The work is **propose a scheme, get approval, move, update every reference, verify**. Half-done is worse than not started.

---

## Phase 1 — Inventory

Confirm scope first: the **exact root directory** to reorganize and any **exclusions** ("don't touch icons/"). Then list every loose file with enough signal to pick a scheme.

Output a table the user can scan:

| File | Kind | Size | Apparent topic | Reference style |
|---|---|---|---|---|
| `public/hero-bg.png` | raster | 240KB | hero/marketing | string URL `/hero-bg.png` |
| `public/icon-cart.svg` | vector icon | 2KB | commerce | `<img src>` + import |
| `public/og-pricing.png` | raster | 180KB | metadata | `metadata.openGraph.images` |

**Reference style** is the load-bearing column — string URLs, static imports, dynamic `import()`, `import.meta.glob`, CSS `url(…)`, and metadata fields each fail differently when paths change.

**Exclude** without asking: `node_modules/`, `dist/`, `.next/`, `build/`, `coverage/`, `.git/`, lockfiles, and codegen output. If the directory IS one of these, stop and ask.

**Exit when** every loose file appears in the inventory table with a Reference style filled in (or marked "no references — flagged").

---

## Phase 2 — Propose a scheme (approval gate)

Pick **one** scheme from the signal in the inventory and present it before touching anything. Default rules:

- **Mixed static assets** (`public/`, `assets/`) → group by **type**: `images/`, `icons/`, `fonts/`, `media/`, `og/`, `docs/`
- **Code + colocated assets in a feature folder** → group by **subfeature**: `hero/`, `pricing/`, `checkout/`
- **Strong topic clustering visible in filenames** (`hero-*`, `pricing-*`, `checkout-*`) → group **by topic** even in `public/`
- **Mixed code modules with no topic signal** → group **by kind** (`hooks/`, `utils/`, `components/`) only if the project already uses that pattern; otherwise leave as-is and tell the user

Present the proposal as an old → new map plus the rule in one sentence:

```
Rule: group public/marketing/* by asset type.

public/marketing/hero-bg.png       → public/marketing/images/hero-bg.png
public/marketing/icon-cart.svg     → public/marketing/icons/icon-cart.svg
public/marketing/og-pricing.png    → public/marketing/og/og-pricing.png
```

**Stop here.** Ask: `(a)pprove / (r)evise scheme / (q)uit`. If the user says revise, redo the proposal — do not start moving files with a scheme they didn't accept.

**URL-change disclosure:** If any move changes a public URL (anything under `public/`, `static/`, served routes), call it out explicitly in the proposal. Default to **preserving public URLs** unless the user opts in to changing them.

---

## Phase 3 — Reference sweep (before moving)

For each file in the move list, find every reference **before** any move. The classes are: static imports, bundler URL imports (`?url`), `import.meta.glob`, string URLs, CSS `url()`, metadata/OG/sitemap, configs, tests/fixtures. Each fails differently when missed and no single grep catches them all.

**MANDATORY — READ [`references/reference-sweep.md`](references/reference-sweep.md)** for the full set of recipes (one per class) and the config table. Run every applicable section.

Write down every hit. If a file has no references, flag it — it may be dead but don't auto-delete (see NEVER list).

**Exit when** every file in the move list has a complete reference list (possibly empty + flagged). Do not start Phase 4 before this.

---

## Phase 4 — Execute

Use `git mv` (preserves history). Then make the moves and reference updates **one atomic pass** — code imports + string URLs + CSS `url()` + configs together, before any commit. A half-updated barrel (`index.ts` re-exports `./a` and `./b`; you moved `a` but not `b`) breaks every importer of the barrel, not just the moved file — the blast radius is the entire downstream graph, not the one file you touched.

If the IDE/TypeScript "move file" refactor is reliable in this project, use it for code imports — then still sweep for string paths (it won't touch those).

**Exit when** every reference from Phase 3's list has been updated and no barrel is half-updated.

---

## Phase 5 — Verify

Run, in order:

```bash
# 1. Type check passes
pnpm exec tsc --noEmit    # or: tsc / yarn tsc / npm run typecheck

# 2. No stale path segments remain (allowing CHANGELOG / migration notes)
rg -n "<old-segment>" --glob '!CHANGELOG*' --glob '!node_modules' --glob '!dist'

# 3. Tests for the touched scope
pnpm test <scope>

# 4. Production build for critical moves (asset pipelines, public/, OG images)
pnpm build
```

If URLs were intentionally changed, spot-check one moved asset is reachable at the **new** URL. If URLs were preserved, spot-check the server still serves correctly.

**If typecheck or build fails mid-verify:** the most common cause is a missed reference class from Phase 3 (usually string URLs or `import.meta.glob`). Re-run the after-edit grep from `references/reference-sweep.md` against the failing module's imports and string paths before reverting. If multiple classes are broken, `git restore -SW .` to undo the moves cleanly and redo Phase 3 with the missed class added.

**Exit when** typecheck passes, the stale-segment grep returns nothing in app code, scoped tests pass, and (for asset/public moves) `pnpm build` succeeds.

---

## Output contract

Report back:

- **Rule** applied (one sentence)
- **Move map** (old → new) — full list, not summarized
- **References updated** — count by category (imports, strings, CSS, configs)
- **URL changes** — explicit list, or "none (URLs preserved)"
- **Verification** — which commands ran and passed

---

## NEVER

- **NEVER move files before the user approves the scheme**
  **Instead:** Present the old → new map in Phase 2 and stop for `(a)pprove / (r)evise`.
  **Why:** The wrong scheme is wasted work twice — once to apply, once to undo. The user's mental model of "where things go" is the load-bearing input.

- **NEVER rely on a single ripgrep for static imports to find all references**
  **Instead:** Sweep separately for static imports, string URLs, CSS `url()`, template literals, metadata fields, and config files (Phase 3).
  **Why:** Dynamic `import()`, `import.meta.glob`, OG image strings, and CSS `url(...)` will not match an `import` regex. Each missed class is a silent prod break.

- **NEVER change a public URL without flagging it in the proposal**
  **Instead:** Default to preserving public URLs; if a move changes one, list it explicitly and require opt-in.
  **Why:** External bookmarks, email templates, OG cache, and SEO depend on URL stability. Breakage shows up days later in metrics, not in the typecheck.

- **NEVER leave a partially-updated barrel file (`index.ts` re-exports)**
  **Instead:** Update every re-export in the same change as the moves it covers.
  **Why:** A barrel that re-exports a moved-or-renamed module breaks the build for every importer of the barrel, not just the moved file — blast radius is huge and easy to miss locally if HMR papers over it.

- **NEVER reorganize without running typecheck + a stale-segment grep after**
  **Instead:** Run `tsc --noEmit` and `rg <old-segment>` as the verification gate before reporting done.
  **Why:** String-based references compile fine and break at runtime. The grep is the only signal that catches them before deploy.

- **NEVER reorganize generated, vendored, or build-output trees**
  **Instead:** Exclude `node_modules/`, `dist/`, `.next/`, `build/`, `coverage/`, codegen output. If the directory IS one of these, ask the user before proceeding.
  **Why:** These are reproduced from source on every build — any reorganization is wiped on the next install/build and may break tooling that hardcodes the layout.

- **NEVER auto-delete a file just because the reference sweep returned zero hits**
  **Instead:** List zero-reference files in the report and let the user confirm before any removal.
  **Why:** Dynamic loaders (`import.meta.glob`, locale/MDX loaders, CMS field references, server-rendered metadata, runtime `fetch('/foo.png')`) match files the static sweep misses. A "dead" asset is often live through a code path that doesn't show up in grep.

---

## Sibling skills

- `file-modularity` — when a file is too large and should be split, not relocated
- `sync-docs` — if the move changes documented paths in README or setup guides
- `agentsystem-core:simplify` — after the move, sweep the diff for now-redundant glue, dead re-exports, and duplicated helpers that the regrouping makes visible
