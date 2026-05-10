import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection, formatTimestamp } from "~/components/views/SettingsParts";
import { SkillsUpsellModal } from "./SkillsUpsellModal";
import { api, ApiError } from "~/lib/api";
import { queryKeys, useLicense, useSkillsStatus } from "~/queries";
import { isProTier } from "~/shared/license";

export function SkillsSettingsPage() {
  const queryClient = useQueryClient();
  const { data: license } = useLicense();
  const { data: status, isLoading } = useSkillsStatus();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPro = !!license && isProTier(license);
  const initializedAt = status?.initializedAt ?? null;
  const isInitialized = !!initializedAt;

  const initialize = useMutation({
    mutationFn: () => api.initializeSkills(),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.skills, {
        initializedAt: result.initializedAt,
        dir: result.dir,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setError(null);
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.status === 402) {
          setPaywallOpen(true);
          return;
        }
        setError(e.message);
        return;
      }
      setError("Couldn't download the skills bundle. Try again in a moment.");
    },
  });

  const onInitialize = () => {
    if (!isPro) {
      setPaywallOpen(true);
      return;
    }
    setError(null);
    initialize.mutate();
  };

  return (
    <>
      <SettingsSection
        title="Mission Control Skills Bundle"
        subtitle="Download the curated skill pack from agentsystem.dev into your local Mission Control data directory. Pro license required."
        headingLevel="h1"
      >
        <Field label="Status">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: isInitialized ? "var(--accent)" : "var(--text-dim)",
              }}
            >
              {isLoading
                ? "Loading…"
                : isInitialized
                  ? "Initialized"
                  : "Not initialized"}
            </span>
            {!isPro && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  padding: "2px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                }}
              >
                Pro required
              </span>
            )}
          </div>
        </Field>
        {isInitialized && (
          <>
            <Field label="Last initialized">
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
                {formatTimestamp(initializedAt)}
              </span>
            </Field>
            {status?.dir && (
              <Field label="Install location">
                <code
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "var(--surface-0)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 9px",
                    display: "inline-block",
                  }}
                >
                  {status.dir}
                </code>
              </Field>
            )}
          </>
        )}
        <Field label="">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                variant="primary"
                onClick={onInitialize}
                disabled={initialize.isPending}
              >
                {initialize.isPending
                  ? "Downloading…"
                  : isInitialized
                    ? "Re-initialize Skills"
                    : "Initialize Skills"}
              </Btn>
            </div>
            {!isInitialized && isPro && (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                Click to download the latest skills bundle to your local Mission
                Control data directory. You can re-run this any time to refresh.
              </p>
            )}
            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 12.5,
                  color: "var(--status-failed)",
                  padding: "8px 10px",
                  border: "1px solid rgba(239, 68, 68, 0.45)",
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.08)",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </Field>
      </SettingsSection>

      <SkillsUpsellModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
      />
    </>
  );
}
