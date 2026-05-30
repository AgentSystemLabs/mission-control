import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { NewSandboxModal, type NewSandboxPayload } from "~/components/views/NewSandboxModal";
import { SandboxConfigModal } from "~/components/views/SandboxConfigModal";
import { LicenseEntryModal } from "~/components/views/LicenseEntryModal";
import { api, ApiError } from "~/lib/api";
import { getElectron, isElectron } from "~/lib/electron";
import { licenseQueryOptions, queryKeys, sandboxesQueryOptions, useSandboxes } from "~/queries";
import { FREE_SANDBOX_CAP, isProTier } from "~/shared/license";
import { LOCAL_SCOPE_ID, scopeToSandboxId } from "~/shared/sandbox";

const LOCAL_DOT = "var(--text-faint)";

function ScopeItem({
  label,
  subtitle,
  color,
  active,
  onClick,
}: {
  label: string;
  subtitle: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "7px 8px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--accent-dim)" : "transparent",
    color: "var(--text)",
  };
  return (
    <button type="button" onClick={onClick} style={style} aria-current={active}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)" }}>{subtitle}</span>
      {active && <Icon name="check" size={12} style={{ color: "var(--accent)" }} />}
    </button>
  );
}

/**
 * Header scope switcher: pick Local (host) or a sandbox. Selecting a scope
 * re-scopes the project list (the list filters on the active scope) and points
 * new work at that environment. Rendered only when sandboxes are enabled.
 */
export function ScopeDropdown() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useSandboxes();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  // Keep the main process's active scope in sync (it routes remote PTY/fs/git and
  // drives per-project runtime). Runs on load + whenever the selected scope changes.
  useEffect(() => {
    if (!data) return;
    void getElectron()?.sandbox.setActive(data.enabled ? scopeToSandboxId(data.activeScopeId) : null);
  }, [data?.activeScopeId, data?.enabled]);

  useEffect(() => {
    if (!data || data.activeScopeId === LOCAL_SCOPE_ID) setConfigOpen(false);
  }, [data?.activeScopeId]);

  // Desktop-only, and only once the feature is enabled.
  if (!isElectron() || !data?.enabled) return null;

  const { sandboxes, activeScopeId } = data;
  const activeSandbox = sandboxes.find((s) => s.id === activeScopeId) ?? null;
  const isLocal = activeScopeId === LOCAL_SCOPE_ID || !activeSandbox;
  const label = isLocal ? "Local" : activeSandbox!.name;
  const activeColor = isLocal ? LOCAL_DOT : activeSandbox!.color ?? "var(--accent)";

  const kindLabel = (kind: string) => (kind === "remote-vm" ? "Remote VM" : "Docker");

  const pick = async (scopeId: string) => {
    setOpen(false);
    if (scopeId === activeScopeId) return;
    qc.setQueryData(queryKeys.sandboxes, (current) =>
      current ? { ...current, activeScopeId: scopeId } : current,
    );
    await api.setActiveScope(scopeId);
    void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
    void router.navigate({ to: "/" });
  };

  const create = async (payload: NewSandboxPayload) => {
    try {
      const { sandbox } = await api.createSandbox(payload);
      await api.setActiveScope(sandbox.id);
      void qc.invalidateQueries({ queryKey: queryKeys.sandboxes });
      void router.navigate({ to: "/" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setCreating(false);
        setPaywallOpen(true);
        return;
      }
      throw e;
    }
  };

  const openCreateSandbox = async () => {
    setOpen(false);
    const latestLicense = await qc.ensureQueryData(licenseQueryOptions());
    const latestSandboxes = await qc.ensureQueryData(sandboxesQueryOptions());
    if (!isProTier(latestLicense) && latestSandboxes.sandboxes.length >= FREE_SANDBOX_CAP) {
      setPaywallOpen(true);
      return;
    }
    setCreating(true);
  };

  const showConfig = !isLocal && activeSandbox;

  return (
    <>
      <div
        role="group"
        aria-label="Sandbox scope"
        style={{ display: "inline-flex", alignItems: "center", gap: 0 }}
      >
        <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
          <Btn
            variant="gray-frame"
            className={showConfig ? "mc-btn-attached-right" : undefined}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            title="Switch sandbox"
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: "50%", background: activeColor, flexShrink: 0 }}
            />
            <span>{label}</span>
            <Icon name="chevron-down" size={11} style={{ color: "var(--text-faint)" }} />
          </Btn>
          {open && (
            <CardFrame
              glow
              solid
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                minWidth: 260,
                boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                padding: 4,
              }}
            >
              <ScopeItem
                label="Local"
                subtitle="Host"
                color={LOCAL_DOT}
                active={isLocal}
                onClick={() => void pick(LOCAL_SCOPE_ID)}
              />
              {sandboxes.map((s) => (
                <ScopeItem
                  key={s.id}
                  label={s.name}
                  subtitle={kindLabel(s.kind)}
                  color={s.color ?? "var(--accent)"}
                  active={s.id === activeScopeId}
                  onClick={() => void pick(s.id)}
                />
              ))}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => void openCreateSandbox()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 8px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    color: "var(--text-dim)",
                    fontSize: 13,
                  }}
                >
                  <Icon name="plus" size={12} />
                  <span>New sandbox</span>
                </button>
              </div>
            </CardFrame>
          )}
        </div>

        {showConfig && (
          <Btn
            variant="gray-frame"
            className="mc-btn-attached-left"
            icon="settings"
            aria-label={`Configure ${activeSandbox!.name}`}
            title={`Configure ${activeSandbox!.name}`}
            onClick={() => setConfigOpen(true)}
            style={{ minWidth: 52, paddingInline: 0 }}
          />
        )}
      </div>

      <SandboxConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        sandboxId={activeSandbox?.id ?? null}
      />

      <NewSandboxModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={create}
      />

      <LicenseEntryModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="paywall"
        paywallContext="sandboxes"
      />
    </>
  );
}
