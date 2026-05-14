import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { authClient, useSession } from "~/lib/auth-client";
import { setRuntimeMode } from "~/lib/runtime";

type ModeState = "loading" | "local" | "cloud" | "error";

export function CloudAuthGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ModeState>("loading");
  const session = useSession();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/runtime/mode")
      .then((res) => {
        if (!res.ok) throw new Error("mode probe failed");
        return res.json() as Promise<{ cloudMode?: boolean }>;
      })
      .then((body) => {
        if (cancelled) return;
        setRuntimeMode(body.cloudMode === true);
        setMode(body.cloudMode ? "cloud" : "local");
      })
      .catch(() => {
        if (!cancelled) setMode("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === "loading") return <AuthShell title="Loading Mission Control" />;
  if (mode === "error") {
    return (
      <AuthShell title="Could not load Mission Control">
        <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
          Retry
        </button>
      </AuthShell>
    );
  }
  if (mode === "local") return <>{children}</>;
  if (session.isPending) return <AuthShell title="Checking your session" />;
  if (session.data?.user) return <>{children}</>;
  return <AuthForm />;
}

function AuthForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({
              name: name.trim() || email.trim(),
              email: email.trim(),
              password,
            })
          : await authClient.signIn.email({
              email: email.trim(),
              password,
            });
      if (result.error) {
        setError(result.error.message || "Authentication failed");
        return;
      }
      window.location.reload();
    } catch {
      setError("Authentication failed. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell title={mode === "sign-up" ? "Create your account" : "Sign in to Mission Control"}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12, width: "min(360px, 90vw)" }}>
        {mode === "sign-up" && (
          <label style={labelStyle}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              style={inputStyle}
            />
          </label>
        )}
        <label style={labelStyle}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            style={inputStyle}
          />
        </label>
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? "Please wait..." : mode === "sign-up" ? "Sign up" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "sign-up" ? "sign-in" : "sign-up");
          }}
          style={linkButtonStyle}
        >
          {mode === "sign-up" ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </AuthShell>
  );
}

function AuthShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        color: "var(--text)",
        padding: 24,
      }}
    >
      <div style={{ display: "grid", gap: 18, justifyItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)", marginBottom: 8 }}>
            MISSION CONTROL CLOUD
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "var(--text-dim)",
} satisfies CSSProperties;

const inputStyle = {
  height: 38,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-1)",
  color: "var(--text)",
  padding: "0 10px",
  outline: "none",
} satisfies CSSProperties;

const buttonStyle = {
  height: 40,
  borderRadius: 8,
  border: "1px solid var(--accent-border)",
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  fontWeight: 600,
  cursor: "pointer",
} satisfies CSSProperties;

const linkButtonStyle = {
  border: 0,
  background: "transparent",
  color: "var(--text-dim)",
  textDecoration: "underline",
  cursor: "pointer",
} satisfies CSSProperties;
