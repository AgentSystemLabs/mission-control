import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Kbd } from "~/components/ui/Kbd";
import { Icon } from "~/components/ui/Icon";
import { useHotkey } from "~/lib/use-hotkey";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { queryKeys } from "~/queries";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import { FREE_PROJECT_CAP, type LicenseState } from "~/shared/license";

export type LicenseEntryReason = "manage" | "paywall";

const PURCHASE_URL = `${ACADEMY_BASE_URL}/mission-control`;

export function LicenseEntryModal({
  open,
  onClose,
  reason = "manage",
}: {
  open: boolean;
  onClose: () => void;
  reason?: LicenseEntryReason;
}) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setError(null);
      // Defer to give Modal focus-trap effect time to settle.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const validate = useMutation({
    mutationFn: (value: string) => api.validateLicense(value),
    onSuccess: ({ license }: { license: LicenseState }) => {
      queryClient.setQueryData(queryKeys.license, license);
      void queryClient.invalidateQueries({ queryKey: queryKeys.license });
      if (license.status === "active") {
        onClose();
      } else if (license.status === "invalid") {
        setError("That license key was rejected. Check the value and try again.");
      } else {
        setError("That license key was rejected. Check the value and try again.");
      }
    },
    onError: () => {
      setError("Something went wrong. Please try again.");
    },
  });

  const submit = () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Enter a license key.");
      return;
    }
    if (validate.isPending) return;
    setError(null);
    validate.mutate(trimmed);
  };

  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      submit();
    },
    { enabled: open && !validate.isPending },
  );

  const continueLite = () => {
    onClose();
  };

  const openPurchase = (e: React.MouseEvent) => {
    const electron = getElectron();
    if (electron?.openExternal) {
      e.preventDefault();
      void electron.openExternal(PURCHASE_URL);
    }
    // otherwise let the <a target="_blank"> handle it
  };

  const isPaywall = reason === "paywall";
  const title = isPaywall ? "Upgrade to Mission Control Pro" : "Activate Mission Control Pro";
  const submitLabel = isPaywall ? "Activate Pro" : "Activate";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={520}
      footer={
        <>
          {!isPaywall && (
            <Btn variant="ghost" onClick={continueLite} disabled={validate.isPending}>
              Continue with Lite
            </Btn>
          )}
          <Btn
            variant="primary"
            onClick={submit}
            disabled={validate.isPending || !key.trim()}
          >
            {validate.isPending ? "Activating…" : submitLabel}
            <Kbd variant="onPrimary">⌘ Enter</Kbd>
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {isPaywall && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--accent-border, var(--border))",
              background: "var(--accent-dim, var(--surface-1))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 600,
                fontSize: 13.5,
                color: "var(--text)",
              }}
            >
              <Icon name="sparkles" size={14} />
              You've reached the {FREE_PROJECT_CAP}-project Lite limit
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Upgrade to Pro for unlimited projects and the curated skills bundle.
              One-time purchase, lifetime updates — no subscription.
            </p>
            <a
              href={PURCHASE_URL}
              target="_blank"
              rel="noreferrer"
              onClick={openPurchase}
              style={{
                fontSize: 12.5,
                color: "var(--accent)",
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Get a license at agentsystem.dev/mission-control →
            </a>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          {isPaywall
            ? "Already have a key? Paste it below to activate Pro instantly."
            : `Paste your license key from agentsystem.dev to unlock Pro features. Lite includes up to ${FREE_PROJECT_CAP} projects.`}
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            License key
          </span>
          <input
            ref={inputRef}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError(null);
            }}
            placeholder="mc_live_..."
            autoComplete="off"
            spellCheck={false}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 13,
              padding: "9px 11px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-0)",
              color: "var(--text)",
              outline: "none",
            }}
          />
        </label>
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
    </Modal>
  );
}
