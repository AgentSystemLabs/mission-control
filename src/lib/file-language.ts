import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@uiw/react-codemirror";

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

export function languageForFilename(name: string): Extension[] {
  const lower = name.toLowerCase();
  const base = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;

  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) {
    return [envLanguage];
  }
  if (base.endsWith(".json") || base === "package.json" || base.endsWith(".jsonc")) {
    return [json()];
  }
  if (base.endsWith(".ts") || base.endsWith(".tsx")) {
    return [javascript({ typescript: true, jsx: base.endsWith(".tsx") })];
  }
  if (base.endsWith(".js") || base.endsWith(".jsx") || base.endsWith(".mjs") || base.endsWith(".cjs")) {
    return [javascript({ jsx: base.endsWith(".jsx") })];
  }
  return [];
}
