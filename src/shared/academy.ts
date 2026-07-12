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
// (../academy/src/pets-ws). In prod this is a dedicated Railway service under
// the agentsystem.dev project; in dev it talks to a locally-run relay
// (`npm run pets:ws` in ../academy). Overridable via VITE_MC_PETS_WS_URL.
export function petsWebSocketUrl(): string {
  const override =
    typeof import.meta !== "undefined"
      ? ((import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_MC_PETS_WS_URL ?? undefined)
      : undefined;
  if (override) return override;
  return isProduction() ? "wss://pets.agentsystem.dev" : "ws://localhost:3031";
}
