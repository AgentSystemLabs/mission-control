const HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'";

export function isMarkdownFilename(name: string | null | undefined): boolean {
  const base = fileBasename(name);
  return base.endsWith(".md") || base.endsWith(".markdown");
}

export function isHtmlFilename(name: string | null | undefined): boolean {
  const base = fileBasename(name);
  return base.endsWith(".html") || base.endsWith(".htm");
}

// Some HTML files are *source* for a bundler, not a standalone document — a
// static HTTP server (or any browser) renders them blank because their real
// content/assets only exist after a build step. Sniffing the source lets the
// preview explain the white screen instead of leaving a mystery void.
export function detectUnrenderableTemplate(source: string): string | null {
  const s = source;
  if (/<include[\s/>]/i.test(s)) {
    return "This page uses <include> partials that only a bundler (e.g. webpack/posthtml) resolves at build time — a browser renders them as nothing.";
  }
  if (/<script[^>]+\bsrc=["'][^"']+\.(?:tsx|ts|jsx)(?:["'?#]|$)/im.test(s)) {
    return "This page loads a TypeScript/JSX entry that must be compiled by its dev server (e.g. Vite) before a browser can run it.";
  }
  // A full document whose body has real content but links no CSS or JS of its
  // own — its stylesheet/script are almost certainly injected by a build step
  // (HtmlWebpackPlugin / Vite). Gated on framework/utility-class signals so a
  // plain inline-styled page isn't flagged.
  if (/<html[\s>]/i.test(s) && /<body[\s>][\s\S]*\S[\s\S]*<\/body>/i.test(s)) {
    const hasScript = /<script[\s>]/i.test(s);
    const hasStyles = /<link[^>]+stylesheet/i.test(s) || /<style[\s>]/i.test(s);
    const needsBuild =
      /\b(?:x-data|x-init|v-[a-z]|ng-[a-z]|data-reactroot)\b/i.test(s) ||
      /class=["'][^"']*\b(?:flex|grid|text-\w|bg-\w|dark:)/i.test(s);
    if (!hasScript && !hasStyles && needsBuild) {
      return "This page links no CSS or JS of its own — those are injected by a build step. Run its dev server to preview the built page.";
    }
  }
  return null;
}

export function buildHtmlPreviewSrcDoc(source: string): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
  const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  const trimmed = source.trimStart();

  if (/<head(?:\s[^>]*)?>/i.test(trimmed)) {
    return source.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${cspMeta}${viewportMeta}`);
  }

  if (/<html(?:\s[^>]*)?>/i.test(trimmed)) {
    return source.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${cspMeta}${viewportMeta}</head>`);
  }

  return `<!doctype html><html><head>${cspMeta}${viewportMeta}</head><body>${source}</body></html>`;
}

function fileBasename(name: string | null | undefined): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  return lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
}
