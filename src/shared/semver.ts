/** Strip a leading `v`/`V` prefix from a version string (e.g. release tags). */
export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/** Core numeric segment before any `-` prerelease or `+` build suffix. */
export function versionCore(version: string): string {
  return stripVersionPrefix(version).split(/[-+]/)[0];
}

function parse(v: string): [number, number, number] | null {
  const parts = versionCore(v).split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return [nums[0], nums[1], nums[2]];
}

export function isNewerSemver(remote: string, local: string): boolean {
  const r = parse(remote);
  const l = parse(local);
  if (!r || !l) return false;
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}
