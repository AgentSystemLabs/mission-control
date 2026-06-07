/**
 * Open a URL in a new tab/window with safe rel flags. `noopener` prevents the
 * opened page from reaching back through `window.opener`; `noreferrer` also
 * strips the Referer header. Use for all external links.
 */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
