# Runners By Stack

Pick the smallest industry-standard runner. Only propose runners on this list.

## TypeScript / JavaScript (Node)

**Default: Vitest** — fastest setup, ESM-first, Jest-compatible API, works across Node and Vite projects.

```
npm install -D vitest
```

Add to `package.json`:
```json
"scripts": { "test": "vitest run" }
```

Test file convention: `*.test.ts` colocated with source.

**Use Jest instead if:** the repo is React Native, uses CRA/Babel-only, or already has Jest infrastructure mentioned in docs.

```
npm install -D jest @types/jest ts-jest
```

**E2E (only on explicit request):** Playwright.
```
npm init playwright@latest
```
Do not propose Playwright for unit-level coverage.

## Python

**Default: pytest**.

```
pip install pytest        # or: uv add --dev pytest, poetry add --group dev pytest
```

Test file convention: `tests/test_<name>.py` at project root, OR `test_<name>.py` colocated.

Add to `pyproject.toml`:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
```

Use stdlib `unittest` only if the project explicitly forbids extra deps.

## Go

**Built-in: `go test`.** No install. Tests live in `<name>_test.go` next to the source file in the same package.

Run: `go test ./...`

Use `testify` for richer assertions only if the user asks. Plain `go test` is the standard.

## Rust

**Built-in: `cargo test`.** No install. Unit tests in `#[cfg(test)] mod tests { ... }` blocks in the source file; integration tests in `tests/` at crate root.

Run: `cargo test`

## Ruby

**Default: RSpec** for app code; **Minitest** if the project is a gem or already uses Minitest.

```
bundle add rspec --group=test
bundle exec rspec --init
```

Test file convention: `spec/<name>_spec.rb`.

## Java / Kotlin

**Default: JUnit 5 (Jupiter)**.

Maven — add to `pom.xml`:
```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.0</version>
  <scope>test</scope>
</dependency>
```

Gradle — add to `build.gradle`:
```groovy
testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
test { useJUnitPlatform() }
```

Test file convention: `src/test/java/<pkg>/<Name>Test.java`.

## .NET / C#

**Default: xUnit**.

```
dotnet new xunit -n <Project>.Tests
dotnet add <Project>.Tests reference <Project>
```

Test file convention: `<Project>.Tests/<Name>Tests.cs`.

## PHP

**Default: PHPUnit**.

```
composer require --dev phpunit/phpunit
```

Test file convention: `tests/<Name>Test.php`.

## Elixir

**Built-in: ExUnit** (ships with Mix). No install. Tests live in `test/<name>_test.exs`.

Run: `mix test`

## When the stack is something else

Stop and ask the user what runner they want. Do not improvise.
