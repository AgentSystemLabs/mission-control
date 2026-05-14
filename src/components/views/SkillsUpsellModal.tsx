import type { ReactNode } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { getRuntime } from "~/lib/runtime";

const AGENTSYSTEM_URL = "https://agentsystem.dev";

export function SkillsUpsellModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const openAgentsystem = () => {
    const electron = getRuntime();
    if (electron?.openExternal) {
      void electron.openExternal(AGENTSYSTEM_URL);
      return;
    }
    window.open(AGENTSYSTEM_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upgrade for AgentSystem Skills"
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Not now
          </Btn>
          <Btn variant="primary" icon="globe" onClick={openAgentsystem}>
            Open agentsystem.dev
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "14px",
            borderRadius: 8,
            border: "1px solid var(--accent-border, var(--border))",
            background: "var(--accent-dim, var(--surface-1))",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              color: "var(--accent)",
              flex: "0 0 auto",
            }}
          >
            <Icon name="sparkles" size={15} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 650, color: "var(--text)" }}>
              Pro includes the curated skills bundle
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--text-dim)",
                lineHeight: 1.55,
              }}
            >
              Upgrade Mission Control to install the maintained AgentSystem skill
              pack into your projects for Codex and Claude Code.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <UpsellPoint>Ship with tested workflows for features, fixes, reviews, and releases.</UpsellPoint>
          <UpsellPoint>Keep every project current with the latest skill updates.</UpsellPoint>
          <UpsellPoint>Unlock Pro project capacity and the skills bundle together.</UpsellPoint>
        </div>

        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
          Review Pro details, pricing, and included skills at agentsystem.dev.
        </p>
      </div>
    </Modal>
  );
}

function UpsellPoint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        color: "var(--text-dim)",
        fontSize: 12.5,
        lineHeight: 1.45,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          color: "var(--accent)",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
        }}
      >
        <Icon name="check" size={11} />
      </span>
      <span>{children}</span>
    </div>
  );
}
