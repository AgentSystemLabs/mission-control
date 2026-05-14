# Doc Surfaces by Change Type

> **Do NOT load this file during Phase 1, 4, or 5.** Only Phase 2 (inventory existing docs) needs it. Loading it earlier or later wastes context.

For each change type, the typical existing doc files that may need updating. Search the repo for these — only edit ones that exist and reference the changed surface.

---

## API surface (routes, request/response, status codes, auth)

- `openapi.yaml` / `openapi.json` / `swagger.yaml` / `swagger.json` (any path)
- `api.md`, `docs/api/**`, `docs/reference/**`
- README sections titled "API", "Endpoints", "Usage"
- Postman collections (`*.postman_collection.json`) — update only if hand-edited
- Client SDK READMEs in monorepos (`packages/*/README.md`)
- Inline route handler doc comments (JSDoc `@route`, FastAPI/Flask docstrings, Spring `@Operation`)

**Watch for generated:** OpenAPI files emitted by `tsoa`, `nestjs/swagger`, `drf-spectacular`, `springdoc`, FastAPI's auto-schema. Edit decorators/annotations in code, not the YAML.

---

## CLI / public function signatures

- README "Usage" / "Commands" sections
- `docs/cli.md`, `man/*.1`, shell-completion files (only if hand-maintained)
- `--help` text in code (often the source of truth — update there)
- JSDoc / docstrings / rustdoc on the function
- TypeDoc / Sphinx output → edit source comments

---

## Environment variables / config keys

- `.env.example`, `.env.sample`, `.env.template`
- `README` "Configuration" / "Environment" sections
- `docker-compose.yml` env blocks (functional, but often documents required vars)
- `config.example.{yaml,toml,json}`
- Helm `values.yaml` comments, k8s manifests with documented envs
- Deployment runbooks in `docs/`

---

## Dependencies / runtime / tech stack

- README "Requirements" / "Prerequisites" / "Stack" sections
- `CONTRIBUTING.md` setup steps
- `docs/setup.md`, `docs/development.md`
- Dockerfile / `.tool-versions` / `.nvmrc` — code, but documents the stack
- ADRs (`docs/adr/**`, `docs/decisions/**`) — append a supersession note only if user requests; do not rewrite past ADRs
- CHANGELOG (only if dep change is user-visible, e.g., minimum Node version bump)

---

## Behavior change / bug fix (same surface, different result)

- CHANGELOG (under "Fixed" or equivalent, only if user-visible)
- Doc comments that *describe behavior* ("Returns null when …", "Throws if …")
- README "Known issues" / "Limitations" sections — remove the entry if the bug is now fixed
- Test names occasionally double as docs; do not rename them as a doc-update task

Skip docs entirely for purely internal refactors with no observable change.

---

## UX copy, flows, or screens

- `docs/user-guide/**`, `docs/tutorials/**`
- README screenshots and walkthroughs
- Help center markdown (`docs/help/**`)
- i18n string files — these are code, not docs; out of scope unless user asks

**Flag for human, do not auto-edit:**
- Screenshots / GIFs / videos — note that they're stale; do not regenerate
- Marketing copy in `docs/landing/**` or website repos
- Anything in an external CMS (Notion, Readme.io, GitBook) — out of repo

---

## Cross-cutting checks

Regardless of change type, also grep for:
- Hardcoded version numbers in docs that should match `package.json` / `Cargo.toml` / `pyproject.toml`
- Code blocks that import or call the changed symbol — these often live in `docs/examples/**` or README and must compile against the new shape
- Links to renamed files or moved sections (`docs/old-name.md` → `docs/new-name.md`)
