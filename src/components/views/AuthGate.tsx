import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { Btn } from "~/components/ui/Btn";
import { api, ApiError } from "~/lib/api";
import { isElectron } from "~/lib/electron";
import {
  createElectronLocalSessionSummary,
  type HostedSessionSummary,
} from "~/lib/hosted-session-summary";
import type { Entitlements } from "~/shared/entitlements";

type HostedEntitlementsState =
  | { status: "idle"; entitlements: null; error: null }
  | { status: "loading"; entitlements: null; error: null }
  | { status: "ready"; entitlements: Entitlements; error: null }
  | { status: "error"; entitlements: null; error: string };

const useHostedSessionEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function useHostedEntitlements(session: HostedSessionSummary | null) {
  const [state, setState] = useState<HostedEntitlementsState>({
    status: "idle",
    entitlements: null,
    error: null,
  });

  useEffect(() => {
    if (!session?.hostedEnabled || !session.authenticated) {
      setState({ status: "idle", entitlements: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", entitlements: null, error: null });
    void api
      .getEntitlements()
      .then(({ entitlements }) => {
        if (!cancelled) {
          setState({ status: "ready", entitlements, error: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 401
            ? "Your Academy session expired. Sign in again to continue."
            : err instanceof Error
              ? err.message
              : "Mission Control could not check your hosted access.";
        setState({ status: "error", entitlements: null, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [session?.hostedEnabled, session?.authenticated, session?.user?.id]);

  return state;
}

export function useHostedSession() {
  const [session, setSession] = useState<HostedSessionSummary | null>(null);
  const [pending, setPending] = useState(true);

  const refresh = useCallback(async () => {
    if (isElectron()) {
      setSession(createElectronLocalSessionSummary());
      setPending(false);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/academy-auth/session", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`session check failed: ${res.status}`);
      setSession((await res.json()) as HostedSessionSummary);
    } catch {
      setSession({
        hostedEnabled: true,
        authenticated: false,
        user: null,
        academyLoginUrl: "/api/academy-auth/login",
        academyAccountUrl: "/api/academy-auth/login",
        academyLogoutUrl: "/api/academy-auth/login",
      });
    } finally {
      setPending(false);
    }
  }, []);

  useHostedSessionEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, pending, refresh };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, pending } = useHostedSession();
  const hostedEntitlements = useHostedEntitlements(session);

  if (
    pending ||
    !session ||
    hostedEntitlements.status === "loading" ||
    (session.hostedEnabled && session.authenticated && hostedEntitlements.status === "idle")
  ) {
    return <AuthPendingShell />;
  }

  if (!session.hostedEnabled) {
    return <>{children}</>;
  }

  if (!session.authenticated) {
    return <AcademyLogin session={session} />;
  }

  if (hostedEntitlements.status === "error") {
    return <HostedAccessError session={session} error={hostedEntitlements.error} />;
  }

  if (!hostedEntitlements.entitlements?.remoteRuntime.allowed) {
    return (
      <HostedSubscriptionRequired
        session={session}
        entitlements={hostedEntitlements.entitlements}
      />
    );
  }

  return <>{children}</>;
}

function AcademyLogin({ session }: { session: HostedSessionSummary }) {
  return (
    <AuthShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>
          Mission Control uses Academy for account login and billing. Sign in
          through Academy to continue.
        </div>
        <form action={session.academyLoginUrl} method="get">
          <button
            className="mc-btn mc-btn-primary mc-btn-md"
            type="submit"
            style={{ justifyContent: "center", width: "100%" }}
          >
            <span className="mc-btn-content">
              <Icon name="shield" size={13} />
              Continue with Academy
            </span>
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

function HostedSubscriptionRequired({
  session,
  entitlements,
}: {
  session: HostedSessionSummary;
  entitlements: Entitlements | null;
}) {
  const router = useRouter();
  const path = router.state.location.pathname;
  const accountUrl = session.academyAccountUrl || "/api/academy-auth/login";
  const reason = entitlements?.remoteRuntime.reason;
  const message =
    reason === "account-blocked"
      ? "Hosted Mission Control is blocked for this account. Contact support if this looks wrong."
      : "Hosted Mission Control requires an active Academy plan before projects, terminals, and agents are available.";

  useEffect(() => {
    if (path !== "/plans") {
      void router.navigate({ to: "/plans", replace: true });
    }
  }, [path, router]);

  return (
    <AuthShell
      title="Activate hosted access"
      subtitle="Academy manages Mission Control hosted plans and billing."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn
            variant="primary"
            icon="external-link"
            onClick={() => window.open(accountUrl, "_blank", "noopener,noreferrer")}
            style={{ flex: "1 1 180px", justifyContent: "center" }}
          >
            Open Academy billing
          </Btn>
          <AcademySignOutButton session={session} />
        </div>
      </div>
    </AuthShell>
  );
}

function HostedAccessError({
  session,
  error,
}: {
  session: HostedSessionSummary;
  error: string;
}) {
  return (
    <AuthShell
      title="Could not verify access"
      subtitle="Mission Control needs to check your Academy entitlement before loading."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>
          {error}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn
            variant="primary"
            icon="refresh"
            onClick={() => window.location.reload()}
            style={{ flex: "1 1 140px", justifyContent: "center" }}
          >
            Retry
          </Btn>
          <AcademySignOutButton session={session} />
        </div>
      </div>
    </AuthShell>
  );
}

function AcademySignOutButton({ session }: { session: HostedSessionSummary }) {
  return (
    <Btn
      variant="ghost"
      icon="shield"
      onClick={async () => {
        const res = await fetch("/api/academy-auth/logout", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => undefined);
        const body = res?.ok
          ? ((await res.json().catch(() => null)) as { academyLogoutUrl?: string } | null)
          : null;
        window.location.href = body?.academyLogoutUrl || session.academyLogoutUrl || "/api/academy-auth/login";
      }}
      style={{ flex: "1 1 120px", justifyContent: "center" }}
    >
      Sign out
    </Btn>
  );
}

function AuthPendingShell() {
  return (
    <div
      id="root"
      style={{
        background: "var(--bg)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 20,
          zIndex: 20,
          ["WebkitAppRegion" as any]: "drag",
        }}
      />
      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 48,
          padding: "0 20px 0 24px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          ["WebkitAppRegion" as any]: "drag",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <img
            src="/images/robot.png"
            alt=""
            width={22}
            height={22}
            style={{ borderRadius: 5, display: "block" }}
          />
          <span
            style={{
              width: 164,
              height: 13,
              borderRadius: 4,
              background: "var(--surface-2)",
            }}
          />
          <span
            style={{
              width: 44,
              height: 22,
              borderRadius: 999,
              border: "1px solid var(--border)",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-2)" }} />
          <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-2)" }} />
          <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-2)" }} />
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        <div className="auth-pending-project-rail" aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }} />
      </div>
    </div>
  );
}

function AuthShell({
  children,
  title = "Sign in to Mission Control",
  subtitle = "Academy verifies your account and hosted runtime access.",
}: {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div
      id="root"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <CardFrame
        style={{
          width: 440,
          maxWidth: "100%",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
              background: "var(--accent-dim)",
              border: "1px solid var(--accent-border)",
            }}
          >
            <Icon name="shield" size={16} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 650 }}>
              {title}
            </h1>
            <div style={{ marginTop: 3, fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>
              {subtitle}
            </div>
          </div>
        </div>
        {children}
      </CardFrame>
    </div>
  );
}
