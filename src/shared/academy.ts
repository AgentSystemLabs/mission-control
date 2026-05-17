function isProduction(): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return true;
  }
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.PROD) {
    return true;
  }
  return false;
}

export const ACADEMY_BASE_URL = isProduction()
  ? "https://agentsystem.dev"
  : "http://localhost:3000";

// Join the (possibly trailing-slashed) base URL to a path that starts with "/".
// Centralized so the trailing-slash strip lives in one place rather than at
// every fetch call site.
export function academyUrl(path: string): string {
  return `${ACADEMY_BASE_URL.replace(/\/$/, "")}${path}`;
}
