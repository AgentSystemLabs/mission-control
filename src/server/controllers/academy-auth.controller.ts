import { HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED } from "~/shared/http-status";
import { json, jsonError } from "./_helpers";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import {
  academyAccountUrl,
  academyLogoutUrl,
  academyLoginUrl,
  clearAcademyStateCookie,
  clearHostedSessionCookie,
  createAcademyStateCookieFromLoginUrl,
  createHostedSessionFromAcademy,
  renewHostedSessionIfNeeded,
  revokeHostedSession,
  verifyAcademyState,
} from "../services/academy-auth";

export function login(request: Request): Response {
  const location = academyLoginUrl(request);
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "set-cookie": createAcademyStateCookieFromLoginUrl(location, request),
    },
  });
}

export async function callback(request: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code")?.trim();
  const token = url.searchParams.get("token")?.trim();
  if (!code && !token) return jsonError(HTTP_BAD_REQUEST, "missing Academy auth code");
  if (!verifyAcademyState(request, url.searchParams.get("state"))) {
    return jsonError(HTTP_UNAUTHORIZED, "invalid Academy auth state");
  }

  const session = await createHostedSessionFromAcademy(request, {
    ...(code ? { code } : {}),
    ...(token ? { token } : {}),
  });

  return new Response(null, {
    status: 302,
    headers: [
      ["location", "/"],
      ["set-cookie", session.cookie],
      ["set-cookie", clearAcademyStateCookie(request)],
    ],
  });
}

export async function session(request: Request): Promise<Response> {
  const context = await getHostedAuthContext(request);
  const renewalCookie = context ? await renewHostedSessionIfNeeded(request) : null;
  return json({
    hostedEnabled: isHostedDatabaseEnabled(),
    authenticated: !isHostedDatabaseEnabled() || !!context,
    user: context
      ? {
          id: context.userId,
          academyUserId: context.academyUserId,
          email: context.email,
        }
      : null,
    academyLoginUrl: "/api/academy-auth/login",
    academyAccountUrl: academyAccountUrl(),
    academyLogoutUrl: academyLogoutUrl(),
  }, renewalCookie ? { headers: { "set-cookie": renewalCookie } } : undefined);
}

export async function logout(request: Request): Promise<Response> {
  await revokeHostedSession(request);
  return json(
    { ok: true, academyLogoutUrl: academyLogoutUrl() },
    {
      headers: {
        "set-cookie": clearHostedSessionCookie(request),
      },
    },
  );
}
