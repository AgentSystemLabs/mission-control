// Repo identity for the multiplayer-pets feature.
//
// Two people count as "working on the same repo" when their git `origin`
// remote normalizes to the same host/owner/repo string. That normalized string
// is the ONLY thing derived from a project's git remote that we care about; it
// is then SHA-256 hashed before it ever leaves the machine (see hashRepoKey),
// so the academy relay and other users only ever see an opaque room id, never
// the actual repo URL, owner, or path.
//
// normalizeRepoRemote is a pure string transform (no fs) so it can be unit
// tested exhaustively and reused on both the server (reading .git/config) and,
// in principle, the client.

/**
 * Normalize a git remote URL to a stable, host-qualified `host/owner/repo` key
 * (lowercased, no scheme, no credentials, no port, no `.git`, no trailing
 * slash). Returns null for anything that isn't a shared network remote — local
 * filesystem paths, `file://` remotes, and unparseable input all yield null so
 * local-only repos simply don't participate in multiplayer pets.
 *
 * Handled forms:
 *   git@github.com:owner/repo.git              (scp-like)
 *   ssh://git@github.com/owner/repo.git        (ssh url)
 *   https://github.com/owner/repo.git          (https, optional creds/port)
 *   http://user:pass@gitlab.com:8443/g/s/repo  (subgroups preserved)
 *   github.com/owner/repo                      (bare host/path)
 */
export function normalizeRepoRemote(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url = rawUrl.trim().replace(/^["'<]+/, "").replace(/["'>]+$/, "");
  if (!url) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
  let hostAndPath: string | null = null;

  if (hasScheme) {
    // <scheme>://[user[:pass]@]host[:port]/path
    const m = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
    if (m) hostAndPath = `${m[1]}/${m[2]}`;
  } else {
    // scp-like: [user@]host:path — host has no slash, and there is a colon.
    const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
    if (scp) {
      hostAndPath = `${scp[1]}/${scp[2]}`;
    } else {
      // bare host/path (e.g. github.com/owner/repo). Require a real-looking
      // dotted hostname so relative paths like ../bare-repo don't slip through.
      const firstSlash = url.indexOf("/");
      const host = firstSlash === -1 ? url : url.slice(0, firstSlash);
      const looksLikeHost =
        /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || /^localhost(:\d+)?$/i.test(host);
      if (looksLikeHost && firstSlash !== -1 && url.length > firstSlash + 1) {
        hostAndPath = url;
      }
    }
  }

  if (!hostAndPath) return null;
  // A backslash means we mis-parsed a Windows path as a remote — reject it.
  if (hostAndPath.includes("\\")) return null;

  const key = hostAndPath
    .toLowerCase()
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  // Need at least host + one path segment to be a real repo remote.
  if (!key.includes("/")) return null;
  return key;
}

/**
 * SHA-256 (hex) of a normalized repo key — the opaque "room" id sent to the
 * relay. Uses the platform WebCrypto (available in the Electron renderer and in
 * Node 20+), so the raw remote URL never travels over the wire.
 */
export async function hashRepoKey(normalizedKey: string): Promise<string> {
  const data = new TextEncoder().encode(normalizedKey);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
