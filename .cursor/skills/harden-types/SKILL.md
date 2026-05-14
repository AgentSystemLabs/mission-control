---
name: harden-types
description: Tighten TypeScript safety in changed files — strip `any`, dangerous `as` casts, `@ts-ignore`/`@ts-expect-error`, and missing return types on exported APIs; add zod (or existing project validator) at boundary surfaces (HTTP/server-fn input, IPC, queue handlers, webhook bodies, env parsing). Auto-fixes the mechanical occurrences inline; reports structural ones that need domain modeling. Trigger phrases — "harden types", "tighten types", "remove anys", "strip ts-ignore", "add zod validation", "validate this input", "audit type safety", "/harden-types". Skip for — pure JS files, generated code (drizzle/openapi/graphql codegen output), test fixtures where `as any` is intentional wiring, and discriminated-union narrowing the compiler can't infer.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Code Harden Types

Each occurrence is examined and classified before any edit. One wrong cast removal cascades into a type-error storm; one over-eager zod schema rejects valid input in production. Read first, then decide.

---

## Phase 1 — Scope

Scope = explicit user paths if given, else `git diff --name-only $(git merge-base HEAD origin/main)` filtered to `*.ts`/`*.tsx`, minus generated dirs (`drizzle/`, `__generated__/`, `dist/`, `build/`, `*.gen.ts`, `*.d.ts`).

**Exit:** the exact list of files to scan is fixed.

---

## Phase 2 — Detect Validator

Pick the validator the project already uses, in this precedence:

1. `zod` in `package.json` → use zod.
2. `valibot` → use valibot.
3. `@sinclair/typebox` → use typebox.
4. None of the above → propose adding `zod` and **wait for `y`** before installing.

Do not introduce a second validator. If multiple are present, use the one already imported in the file's nearest sibling.

**Exit:** validator name + import path are known.

---

## Phase 3 — Classify Each Occurrence

Before classifying any cast, read the call site that produces the value — the cast's correctness depends on its source, not its target.

For every flagged construct in the scope, classify before touching it. **MANDATORY — READ [`references/classification.md`](references/classification.md)** for the full decision tree (boundary vs. internal, mechanical vs. structural, legitimate `as`).

Constructs to flag:
- `: any` parameter, return, variable, generic
- `as <T>` and `as unknown as <T>`
- `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`
- Exported function/class method without an explicit return type when the body returns a non-trivial value
- Boundary entry points (see classification.md) that read external input without a validator

Per occurrence, write a one-line classification: `MECHANICAL | STRUCTURAL | LEGITIMATE`.

- **MECHANICAL** — fix inline now.
- **STRUCTURAL** — add to the report; do not touch the code.
- **LEGITIMATE** — leave it; if no comment explains why, add a single-line `// HARDEN-OK: <reason>`.

**Exit:** every flagged occurrence has a classification.

---

## Phase 4 — Apply Mechanical Fixes

For each MECHANICAL occurrence, apply the matching fix:

| Construct | Fix |
|---|---|
| `(x: any)` where the call sites all pass one shape | replace with the inferred concrete type |
| `as SomeType` where `SomeType` is structurally compatible | remove the cast |
| `as unknown as T` over a JSON parse / fetch / message handler | replace with `Schema.parse(input)` from the chosen validator |
| `@ts-expect-error` over a now-correct line | delete the directive |
| `@ts-ignore` over a real error | classify as STRUCTURAL — do not silently delete |
| Missing return type on exported function | add the inferred return type explicitly |
| Boundary entry without validator | wrap input in `Schema.parse(...)`; export the schema next to the handler |

After each file's edits, run the project's typecheck. Detect from `package.json` scripts in this order: `typecheck`, `check-types`, `tsc`. If none exists, fall back to `npx tsc --noEmit -p <nearest tsconfig.json>` (walk up from the edited file). The build must stay green file-by-file. If a fix produces new errors elsewhere, revert that one fix and re-classify it as STRUCTURAL.

**Exit:** typecheck passes; every MECHANICAL item is either fixed or downgraded to STRUCTURAL.

---

## Phase 5 — Report

Print one block per file:

```
<path>
  Fixed:       <n> mechanical
  Needs review: <n> structural — <one-line reason each>
  Left as-is:   <n> legitimate (annotated)
```

For STRUCTURAL items, give the file path, line, the construct, and the question the user must answer (e.g., "what shape does the webhook actually deliver?"). Do not propose code for these; the resolution depends on domain knowledge the skill does not have.

---

## NEVER

- **NEVER strip an `as` cast without first reading where the value comes from.**
  **Instead:** if the source is `JSON.parse`, `fetch`, `postMessage`, a queue payload, or any external boundary, replace with a validated parse — do not just remove the cast.
  **Why:** the cast was masking the fact that the value is `unknown`. Removing the cast without adding validation moves the runtime bug from "obvious wrong type" to "implicit wrong type" — same bug, harder to find.

- **NEVER delete `@ts-ignore` / `@ts-expect-error` over a line that still produces an error.**
  **Instead:** classify as STRUCTURAL and report it.
  **Why:** the directive existed for a reason. Removing it just to "clean up" turns a known suppressed error into a build break — and erases the intent encoded in the suppression.

- **NEVER auto-install a validator dependency.**
  **Instead:** propose the install command and wait for explicit `y`.
  **Why:** a new runtime dep changes the lockfile, bundle size, and supply-chain surface. The user owns that decision.

- **NEVER add zod schemas to internal call sites.**
  **Instead:** validate at the trust boundary only (HTTP body, query, params; server-fn input; webhook payload; env var parsing; queue message; IPC message). Internal callers get types from the schema's inferred output.
  **Why:** runtime validation on every internal call is wasted CPU and noise. The boundary is where untrusted input enters; everything past that point is already type-safe by construction.

- **NEVER remove an `as` used to narrow a discriminated union the compiler can't infer.**
  **Instead:** mark LEGITIMATE and leave a `// HARDEN-OK: discriminated narrowing — <field>` comment if none exists.
  **Why:** these casts are load-bearing. Removing them either breaks the build or forces a refactor of the union shape — out of scope for this skill.

- **NEVER edit generated files.**
  **Instead:** if a generated file leaks `any` into the consumer, fix the consumer (wrap the import) — not the generated source.
  **Why:** generated files are overwritten on the next codegen. Fixes there evaporate; fixes at the consumer survive.

- **NEVER run a project-wide codemod or `sed`/`jscodeshift` sweep across the file set.**
  **Instead:** edit one file, run typecheck, then move on to the next.
  **Why:** a sweep that produces 200 type errors at once is unattributable — you can't tell which fix caused which error. Per-file edits keep each change individually verifiable and revertable.

- **NEVER bundle unrelated refactors with hardening.**
  **Instead:** restrict edits to the type-safety changes. Surface anything else to the user as a separate task.
  **Why:** mixed diffs make it impossible to tell a behavior change from a type-only change — and that's the exact thing this skill exists to make legible.
