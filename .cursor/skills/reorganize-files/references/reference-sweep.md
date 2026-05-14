# Reference sweep recipes

Load only when running Phase 3 of `reorganize-files`. Each section targets one class of reference. Run all of them — no single recipe finds everything, and the classes fail differently when missed.

## Static imports + bundler URL imports

```bash
# Imports by basename
rg -n "from ['\"].*<basename>" --glob '!node_modules' --glob '!dist' --glob '!.next'

# Bundler URL form (Vite/Rsbuild): import url from './foo.png?url'
rg -n "['\"].*<basename>(\?url|\?raw|\?inline)?['\"]" --glob '!node_modules'

# import.meta.glob patterns — these match by directory glob, not by filename
rg -n "import\.meta\.glob" --glob '!node_modules'
```

`import.meta.glob` is the silent killer: a glob pattern like `'./images/**/*.png'` will quietly stop matching files you moved out of `images/`, and TypeScript will not complain.

## String URL paths (the sharp edge)

Search the OLD path **segment**, not the basename. A file named `hero.png` may be referenced as `/marketing/hero.png` in dozens of places that won't match a basename grep on its own.

```bash
rg -n "['\"]/<old-segment>" --glob '!node_modules' --glob '!dist'

# Template literals and href/src attributes
rg -n "(href|src|content)=['\"].*<old-segment>" --glob '!node_modules'
rg -n "\`.*<old-segment>" --glob '!node_modules'
```

## CSS / styled-components / Tailwind arbitrary values

```bash
rg -n "url\(.*<basename>" --glob '*.{css,scss,sass,less,vue,svelte,astro}'
rg -n "@import.*<basename>" --glob '*.{css,scss,sass,less}'

# Tailwind arbitrary values: bg-[url('/foo.png')]
rg -n "\[url\(['\"]?.*<old-segment>" --glob '*.{ts,tsx,js,jsx,html}'
```

## Metadata, OG, sitemap, robots, JSON-LD

These hide in places linting/typecheck never sees:

```bash
rg -n "<basename>" \
  -g 'metadata.{ts,tsx,js,json}' \
  -g 'app/**/{layout,page,head}.{ts,tsx}' \
  -g 'sitemap.{ts,xml}' \
  -g 'robots.{ts,txt}' \
  -g 'opengraph*' \
  -g 'manifest.{json,webmanifest}'

# JSON-LD blobs embedded in components
rg -n '"image"\s*:\s*"[^"]*<old-segment>'
```

## Configs that embed paths

Check each that exists in the project:

| Config | What to look for |
|---|---|
| `tsconfig.json` / `tsconfig.*.json` | `paths`, `baseUrl` |
| `vite.config.*` | `publicDir`, `assetsInclude`, `resolve.alias`, `build.rollupOptions.input` |
| `next.config.*` | `images.domains`, `rewrites`, `redirects`, `assetPrefix` |
| `tailwind.config.*` | `content` globs, `theme.backgroundImage` |
| `.storybook/main.*` | `staticDirs`, `stories` globs |
| `playwright.config.*` | `testDir`, fixture paths |
| `vitest.config.*` / `jest.config.*` | `moduleNameMapper`, `setupFiles`, `testMatch`, snapshot paths |
| `astro.config.*` / `svelte.config.*` / `nuxt.config.*` | framework-specific publicDir / assets options |
| `postcss.config.*` | `from` paths in plugin options |
| i18n loaders (`next-intl`, `i18next`, `formatjs`) | locale file paths, message catalog globs |
| `package.json` | `exports`, `files`, scripts that reference paths |

## Tests, fixtures, snapshots

```bash
# Fixture directories the test runner reads at runtime
rg -n "<old-segment>" \
  -g '**/__fixtures__/**' \
  -g '**/__mocks__/**' \
  -g '**/*.{spec,test}.{ts,tsx,js,jsx}'

# Playwright/Cypress page.goto and screenshot paths
rg -n "(page\.goto|cy\.visit|toMatchScreenshot)\(['\"][^'\"]*<old-segment>"

# MSW handlers — request URLs are strings
rg -n "(rest|http)\.(get|post|put|delete|patch)\(['\"][^'\"]*<old-segment>"
```

## After-edit verification grep

After Phase 4, run the segment-based grep one more time. Allow hits in `CHANGELOG*`, migration notes, and `.git/`. Anything else is a missed reference:

```bash
rg -n "<old-segment>" \
  --glob '!CHANGELOG*' \
  --glob '!node_modules' \
  --glob '!dist' \
  --glob '!.next' \
  --glob '!.git'
```

If this returns hits inside `src/`, `app/`, `public/`, or any config — stop and update them before declaring Phase 5 complete.
