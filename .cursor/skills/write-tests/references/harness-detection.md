# Harness Detection

Apply rules in order. First match wins.

## Precedence

1. **Config file present** (highest signal — runner is actively configured)
2. **Lockfile entry** (runner is installed)
3. **Manifest script** (runner is wired but maybe not configured)
4. **Convention-only** (test files exist with no runner config — investigate)

## Config files by runner

| Runner | Config files |
|---|---|
| Vitest | `vitest.config.{ts,js,mjs}`, `vite.config.*` with `test:` block |
| Jest | `jest.config.{ts,js,cjs,mjs}`, `jest.config.json`, `"jest":` key in `package.json` |
| Mocha | `.mocharc.{js,cjs,json,yml}`, `mocha` key in `package.json` |
| Playwright | `playwright.config.{ts,js}` |
| Cypress | `cypress.config.{ts,js}` |
| pytest | `pytest.ini`, `pyproject.toml` `[tool.pytest.ini_options]`, `setup.cfg` `[tool:pytest]`, `tox.ini` |
| unittest | (Python stdlib — look for `tests/` + `python -m unittest` in scripts) |
| go test | (built-in — look for `*_test.go` files anywhere in module) |
| cargo test | (built-in — look for `#[cfg(test)]` or `tests/` dir at crate root) |
| RSpec | `.rspec`, `spec/spec_helper.rb`, `spec/` dir |
| Minitest | `test/test_helper.rb`, `test/` dir, `Rakefile` with `Rake::TestTask` |
| JUnit (Maven) | `pom.xml` with `junit-jupiter` dependency, `src/test/java/` |
| JUnit (Gradle) | `build.gradle{,.kts}` with `useJUnitPlatform()`, `src/test/java/` or `src/test/kotlin/` |
| PHPUnit | `phpunit.xml{,.dist}`, `tests/` dir |
| xUnit (.NET) | `*.csproj` with `<PackageReference Include="xunit"`, `*Tests.cs` files |

## Lockfile signals

- `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` → grep for runner names above
- `poetry.lock` / `uv.lock` / `requirements*.txt` / `Pipfile.lock` → `pytest`, `unittest`
- `Gemfile.lock` → `rspec`, `minitest`
- `go.sum` is irrelevant (testing is built-in); `go.mod` presence + any `*_test.go` = go test
- `Cargo.lock` is irrelevant (testing is built-in); `Cargo.toml` + `[dev-dependencies]` or `tests/` = cargo test

## Script signals

- `package.json` `"scripts"` → look for `"test"`, `"test:unit"`, `"test:e2e"` and the runner they invoke
- `pyproject.toml` `[tool.poetry.scripts]` or a `Makefile`
- `Rakefile`, `Makefile`, `justfile`, `Taskfile.yml` — grep for `test` targets

## Test file conventions

Once a runner is identified, locate where tests live:

| Convention | Pattern |
|---|---|
| Colocated | `foo.ts` + `foo.test.ts` (or `.spec.ts`) in same dir |
| `__tests__/` | `__tests__/foo.test.ts` next to source |
| Top-level `tests/` | `tests/test_foo.py`, `tests/foo_test.go` |
| Top-level `test/` | Ruby/Java/Rust convention |
| `spec/` | RSpec convention |
| `src/test/` | Maven/Gradle JVM convention |

Pick whichever pattern is already used in the repo. Do not introduce a second pattern.

## When detection is ambiguous

- Multiple config files (e.g., both `vitest.config.ts` and `jest.config.ts` exist) → ask the user which to use; do not pick silently. Most-recently-modified is a hint, not a decision.
- Config file but no installed dep (config exists, lockfile missing the runner) → treat as "no harness" and re-install.
- Test files exist but no runner config or dep → ask the user. Most likely a stale leftover.
