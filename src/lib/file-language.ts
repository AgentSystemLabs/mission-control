import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sass } from "@codemirror/lang-sass";
import { less } from "@codemirror/lang-less";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { vue } from "@codemirror/lang-vue";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { csharp, kotlin, scala, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { r as rLang } from "@codemirror/legacy-modes/mode/r";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import type { Extension } from "@codemirror/state";

const envLanguage = StreamLanguage.define({
  name: "dotenv",
  token(stream) {
    if (stream.sol() && stream.match(/#.*/)) return "comment";
    if (stream.sol() && stream.match(/[A-Za-z_][A-Za-z0-9_]*(?==)/)) return "variableName";
    if (stream.match("=")) return "operator";
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.next() == null) return null;
    return null;
  },
});

// Wrap a CodeMirror legacy (stream-based) mode as a language extension.
const legacy = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser);

// Extension (without leading dot) -> language factory. Factories are lazy so we
// only construct the parser for the file that's actually opened.
const byExtension: Record<string, () => Extension> = {
  // Markup / templates
  html: () => html(),
  htm: () => html(),
  xhtml: () => html(),
  vue: () => vue(),
  svelte: () => html(),
  astro: () => html(),
  xml: () => xml(),
  svg: () => xml(),
  xsd: () => xml(),
  xsl: () => xml(),
  xslt: () => xml(),
  plist: () => xml(),
  storyboard: () => xml(),
  xib: () => xml(),

  // Stylesheets
  css: () => css(),
  scss: () => sass(),
  sass: () => sass({ indented: true }),
  less: () => less(),

  // Docs / data / config
  md: () => markdown(),
  markdown: () => markdown(),
  mdx: () => markdown(),
  yaml: () => yaml(),
  yml: () => yaml(),
  toml: () => legacy(toml),
  ini: () => legacy(properties),
  cfg: () => legacy(properties),
  conf: () => legacy(properties),
  properties: () => legacy(properties),
  editorconfig: () => legacy(properties),

  // General-purpose languages
  py: () => python(),
  pyi: () => python(),
  pyw: () => python(),
  sql: () => sql(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  kt: () => legacy(kotlin),
  kts: () => legacy(kotlin),
  scala: () => legacy(scala),
  sc: () => legacy(scala),
  cs: () => legacy(csharp),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  "c++": () => cpp(),
  hpp: () => cpp(),
  hh: () => cpp(),
  hxx: () => cpp(),
  m: () => legacy(objectiveC),
  mm: () => legacy(objectiveC),
  php: () => php(),
  rb: () => legacy(ruby),
  lua: () => legacy(lua),
  pl: () => legacy(perl),
  pm: () => legacy(perl),
  swift: () => legacy(swift),
  r: () => legacy(rLang),
  clj: () => legacy(clojure),
  cljs: () => legacy(clojure),
  cljc: () => legacy(clojure),
  edn: () => legacy(clojure),
  hs: () => legacy(haskell),
  groovy: () => legacy(groovy),
  gradle: () => legacy(groovy),

  // Shell / scripts
  sh: () => legacy(shell),
  bash: () => legacy(shell),
  zsh: () => legacy(shell),
  ksh: () => legacy(shell),
  fish: () => legacy(shell),
  ps1: () => legacy(powerShell),
  psm1: () => legacy(powerShell),
  psd1: () => legacy(powerShell),

  // Diffs / patches
  diff: () => legacy(diff),
  patch: () => legacy(diff),
};

// Files with no extension (or whose name matters more than the extension).
function basenameLanguage(base: string): Extension | null {
  if (
    base === "dockerfile" ||
    base === "containerfile" ||
    base.startsWith("dockerfile.") ||
    base.endsWith(".dockerfile")
  ) {
    return legacy(dockerFile);
  }
  if (
    base === "gemfile" ||
    base === "rakefile" ||
    base === "podfile" ||
    base === "brewfile" ||
    base === "guardfile" ||
    base === "capfile" ||
    base === "vagrantfile"
  ) {
    return legacy(ruby);
  }
  if (
    base === ".bashrc" ||
    base === ".bash_profile" ||
    base === ".bash_aliases" ||
    base === ".bash_logout" ||
    base === ".zshrc" ||
    base === ".zshenv" ||
    base === ".zprofile" ||
    base === ".zlogin" ||
    base === ".profile" ||
    base === ".inputrc"
  ) {
    return legacy(shell);
  }
  if (base === ".gitconfig" || base === ".npmrc" || base === ".yarnrc" || base === ".flake8") {
    return legacy(properties);
  }
  return null;
}

export function languageForFilename(name: string): Extension[] {
  try {
    const lang = resolveLanguage(name);
    return lang ? [lang] : [];
  } catch (err) {
    // Unsupported / broken language packs must not take down the file editor —
    // open as plain text instead (common when CodeMirror packages duplicate).
    console.warn(`[file-language] falling back to plain text for ${name}:`, err);
    return [];
  }
}

function resolveLanguage(name: string): Extension | null {
  const lower = name.toLowerCase();
  const base = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;

  // Env files (.env, .env.local, foo.env).
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) {
    return envLanguage;
  }

  // TypeScript / JavaScript need per-dialect config, so handle them explicitly.
  if (base.endsWith(".ts") || base.endsWith(".mts") || base.endsWith(".cts")) {
    return javascript({ typescript: true });
  }
  if (base.endsWith(".tsx")) {
    return javascript({ typescript: true, jsx: true });
  }
  if (base.endsWith(".jsx")) {
    return javascript({ jsx: true });
  }
  if (base.endsWith(".js") || base.endsWith(".mjs") || base.endsWith(".cjs")) {
    return javascript();
  }

  // JSON (including JSONC / JSON5 variants).
  if (base.endsWith(".json") || base.endsWith(".jsonc") || base.endsWith(".json5")) {
    return json();
  }

  // Special filenames that carry no (useful) extension.
  const named = basenameLanguage(base);
  if (named) return named;

  // Everything else, keyed by file extension.
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot + 1);
    const factory = byExtension[ext];
    if (factory) return factory();
  }

  return null;
}
