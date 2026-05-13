/**
 * Mirrors src/shared/errors.ts for the electron main process. Kept duplicated
 * because the electron tsconfig sets rootDir to ./electron and cannot import
 * from ../src. Logic must stay byte-identical to src/shared/errors.ts.
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
