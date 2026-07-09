/** Default prompt injected when Ship opens an AI sync session. */
export const DEFAULT_SHIP_PROMPT =
  "commit my changes, then push my latest branch changes to remote, and if upstream changes exist, pull them, fix conflict, and push when resolved.";

export function normalizeShipPrompt(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SHIP_PROMPT;
  const trimmed = value.trim();
  return trimmed || DEFAULT_SHIP_PROMPT;
}
