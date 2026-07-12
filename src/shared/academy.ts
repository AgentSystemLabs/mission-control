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

// WebSocket endpoint for the standalone "multiplayer pets" relay
// (../academy/pets-ws) — a dedicated Railway service under the agentsystem.dev
// project. Dev and prod both target the deployed relay so multiplayer pets work
// without running a local relay; set VITE_MC_PETS_WS_URL=ws://localhost:3031 to
// point dev at a locally-run one (`npm run pets:ws` in ../academy).
export function petsWebSocketUrl(): string {
  const override =
    typeof import.meta !== "undefined"
      ? ((import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_MC_PETS_WS_URL ?? undefined)
      : undefined;
  return override || "wss://pets.agentsystem.dev";
}
