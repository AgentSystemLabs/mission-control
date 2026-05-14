import { isLoopbackHost } from "./loopback";

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

export function isAllowedAcademyDownloadUrl(downloadUrl: string): boolean {
  try {
    const u = new URL(downloadUrl);
    if (!isProduction() && u.protocol === "http:" && isLoopbackHost(u.hostname)) {
      return true;
    }
    if (u.protocol !== "https:") return false;
    const base = new URL(ACADEMY_BASE_URL);
    if (u.hostname === base.hostname) return true;
    const parts = base.hostname.split(".");
    if (parts.length >= 2) {
      const apex = parts.slice(-2).join(".");
      if (u.hostname === apex || u.hostname.endsWith(`.${apex}`)) return true;
    }
    if (!isProduction() && isLoopbackHost(u.hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
