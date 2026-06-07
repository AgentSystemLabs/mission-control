import { requireBearerToken } from "./auth";

/**
 * A request is "trusted local" when it carries the local API bearer token.
 * Mission Control is a local desktop app — there is no untrusted web runtime —
 * so a valid bearer is sufficient proof the request originates from the app.
 */
export function isElectronLocalApiRequest(request: Request): boolean {
  return requireBearerToken(request).ok;
}
