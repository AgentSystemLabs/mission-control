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
