/**
 * Opaque, non-cryptographic unique id: `${prefix}-${base36 time}-${base36 random}`.
 * Ids are treated as opaque strings — nothing parses the segments after the prefix.
 */
export function shortId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
