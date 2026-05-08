import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection, formatTimestamp } from "~/components/views/SettingsParts";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { LicenseEntryModal } from "./LicenseEntryModal";
import { api } from "~/lib/api";
import { queryKeys, useLicense } from "~/queries";
import { type LicenseState, type LicenseStatus } from "~/shared/license";

const STATUS_LABEL: Record<LicenseStatus, string> = {
  active: "Active",
  invalid: "Invalid",
};

const STATUS_COLOR: Record<LicenseStatus, string> = {
  active: "var(--accent)",
  invalid: "var(--status-failed)",
};

function StatusPill({ license }: { license: LicenseState }) {
  if (!license.hasKey) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 9px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        Lite
      </span>
    );
  }
  const status = license.status ?? "invalid";
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 9px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontFamily: "var(--mono)",
        fontSize: 11,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LicenseSettingsPage() {
  const queryClient = useQueryClient();
  const { data: license } = useLicense();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.removeLicense(),
    onSuccess: ({ license: next }) => {
      queryClient.setQueryData(queryKeys.license, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.license });
      setConfirmRemoveOpen(false);
    },
  });

  const safeLicense: LicenseState = license ?? {
    hasKey: false,
    maskedKey: null,
    status: null,
    plan: null,
    lastValidatedAt: null,
    payload: null,
  };

  return (
    <>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        License
      </h1>
      <SettingsSection
        title="Mission Control Pro"
        subtitle="Unlock Pro by entering a signed license key. Lite includes up to 2 projects."
      >
        <Field label="Status">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusPill license={safeLicense} />
            {safeLicense.plan && (
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
                {safeLicense.plan}
              </span>
            )}
          </div>
        </Field>
        {safeLicense.hasKey && (
          <>
            <Field label="License key">
              <code
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: "var(--text)",
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "6px 9px",
                  display: "block",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {safeLicense.maskedKey}
              </code>
            </Field>
            <Field label={safeLicense.payload?.expiresAt ? "Valid until" : "Offline access"}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
                {safeLicense.payload?.expiresAt
                  ? formatTimestamp(safeLicense.payload.expiresAt)
                  : "Lifetime"}
              </span>
            </Field>
          </>
        )}
        <Field label="">
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" onClick={() => setModalOpen(true)}>
              {safeLicense.hasKey ? "Change License Key…" : "Enter License Key…"}
            </Btn>
            {safeLicense.hasKey && (
              <Btn
                variant="danger"
                onClick={() => setConfirmRemoveOpen(true)}
                disabled={remove.isPending}
              >
                Remove License
              </Btn>
            )}
          </div>
        </Field>
      </SettingsSection>

      <LicenseEntryModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ConfirmDialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={() => remove.mutate()}
        title="Remove license?"
        confirmLabel="Remove"
        variant="danger"
        loading={remove.isPending}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Mission Control will revert to the Lite tier. You can re-enter the key
          anytime.
        </p>
      </ConfirmDialog>
    </>
  );
}
