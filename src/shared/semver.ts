function parse(v: string): [number, number, number] | null {
  const stripped = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  const parts = stripped.split(".");
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
