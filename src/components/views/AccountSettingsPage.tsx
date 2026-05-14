import { useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { authClient, useSession } from "~/lib/auth-client";

export function AccountSettingsPage() {
  const session = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session.data?.user;

  const logout = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.reload();
          },
        },
      });
      if (result.error) {
        const message = result.error.message || "Sign out failed.";
        setError(message);
        toast.error(message);
        setPending(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign out failed.";
      setError(message);
      toast.error(message);
      setPending(false);
    }
  };

  return (
    <SettingsSection
      title="Account"
      subtitle="Manage your Mission Control Cloud session."
      headingLevel="h1"
    >
      <Field label="Signed in as">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              {session.isPending ? "Checking session..." : user?.name || "Cloud account"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              {session.isPending
                ? "Loading your account details."
                : user?.email || "No active cloud session found."}
            </div>
          </div>
        </div>
      </Field>

      <Field label="Session">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              Sign out of Mission Control Cloud
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              You will return to the sign-in screen on this device.
            </div>
          </div>
          <Btn
            type="button"
            variant="danger"
            onClick={logout}
            disabled={pending || session.isPending || !user}
            style={{ flexShrink: 0 }}
          >
            {pending ? "Signing out..." : "Log out"}
          </Btn>
        </div>
        {error && (
          <div
            role="alert"
            style={{ marginTop: 8, fontSize: 12, color: "var(--danger)", lineHeight: 1.45 }}
          >
            {error}
          </div>
        )}
      </Field>
    </SettingsSection>
  );
}
