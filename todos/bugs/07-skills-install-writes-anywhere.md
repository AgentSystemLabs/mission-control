# [CRITICAL] `POST /api/skills/install` extracts a tarball to a caller-chosen directory, unauthenticated

**Files:** `src/server/api-router.ts:409-425`, `src/server/services/install-skills.ts:109-208`
**Category:** Auth bypass + path-controlled file write → indirect RCE
**Severity:** Critical

## What's wrong

The route is anonymous (no `requireBearerToken`). The body's `projectPath` is used verbatim as the `cwd` for `tar.extract` (`install-skills.ts:202`).

The per-entry filter (`normalizeEntryPath`) blocks `..`, absolute paths, NUL bytes, and only allows entries under `.claude/skills/<name>/`, `.codex/skills/<name>/`, and `.agentsystem/skills-version.json` — protecting against zip-slip *within* the chosen `cwd`. But the choice of `cwd` itself is unconstrained: `~`, `/Users/<victim>`, any directory the user has write access to.

## Why fixing this is important — what could go wrong

Combined with finding 01 (no origin check), a malicious webpage can:

```js
fetch("http://127.0.0.1:<port>/api/skills/install", {
  method: "POST",
  body: JSON.stringify({
    projectPath: "/Users/victim",
    harnesses: { claude: true, codex: true },
  }),
  headers: { "content-type": "application/json" },
  mode: "no-cors",
});
```

Attacker-controlled files land under `/Users/victim/.claude/skills/<name>/` — the user's *global* Claude skills directory. Claude auto-loads skills on its next invocation in any project, so the planted skill's `SKILL.md` content (and any scripts it references) becomes an RCE vector the next time the user runs Claude anywhere.

Even with the Academy-side license gate, the attacker only needs the tarball to contain a single shell-invoking skill. The attacker controls *where* it lands.

## How to fix it

1. Require auth on the route — once finding 01 lands, this is automatic; until then, add `requireBearerToken` at `src/server/api-router.ts:409`.
2. Validate `projectPath` against the `projects` table: reject any value not present as `project.path`. Use the existing `listProjects()` or a direct query in `src/server/services/projects.ts`.
3. Canonicalize the resolved target directory (`fs.realpathSync`) and confirm it's still under the registered project root after symlink resolution.
4. Reject `projectPath` values that resolve to the user's home directory or any non-project location.
