/**
 * Drop cooldown stamps that expired long ago (10× the window) so a per-key
 * cooldown map stays bounded over a long-lived process instead of keeping one
 * entry per key ever seen. Called at the write site — O(size), and size stays
 * small once sweeping runs.
 */
export function sweepStaleCooldowns(
  map: Map<string, number>,
  now: number,
  windowMs: number,
): void {
  const cutoff = now - windowMs * 10;
  for (const [key, at] of map) {
    if (at < cutoff) map.delete(key);
  }
}
