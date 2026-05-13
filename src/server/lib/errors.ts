/**
 * Centralized unknown-error → string coercion so server catch blocks can
 * type their bindings as `unknown` (per TS strict default) without sprinkling
 * `e: any` everywhere just to read `.message`.
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(e);
  } catch {
    return "Unknown error";
  }
}
