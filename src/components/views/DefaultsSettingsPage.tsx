import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  COMMIT_CLI_DESCRIPTION,
  COMMIT_CLI_LABEL,
  COMMIT_CLI_VALUES,
  type CommitCli,
  type CommitCliDetection,
} from "~/shared/commit-cli";

export function DefaultsSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const currentCli = settings?.commitCli ?? null;

  const [detection, setDetection] = useState<CommitCliDetection | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const runDetect = async () => {
    setDetecting(true);
    setDetectError(null);
    try {
      const { detected } = await api.detectCommitCli();
      setDetection(detected);
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "detection failed");
    } finally {
      setDetecting(false);
    }
  };

  // Re-detect every time the panel mounts so newly-installed CLIs appear
  // without forcing the user to restart the app.
  useEffect(() => {
    void runDetect();
  }, []);

  const selectCli = async (cli: CommitCli | null) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, {
        ...previous,
        commitCli: cli,
      });
    }
    try {
      const next = await api.updateSettings({ commitCli: cli });
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw e;
    }
  };

  return (
    <>
      <SettingsSection
        title="Defaults"
        subtitle="Tools Mission Control reaches for behind the scenes."
        headingLevel="h1"
      >
        <Field label="Commit message CLI">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                lineHeight: 1.55,
              }}
            >
              When you press <strong>Ship</strong>, Mission Control spawns this
              CLI in print mode to draft a commit message from the staged diff.
              The first time you ship, we auto-detect which of these tools are
              on your PATH and pick the first available one.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {COMMIT_CLI_VALUES.map((cli) => (
                <CliOption
                  key={cli}
                  cli={cli}
                  selected={currentCli === cli}
                  installed={detection?.[cli] ?? null}
                  onSelect={() => void selectCli(cli)}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 4,
              }}
            >
              <Btn
                variant="ghost"
                size="sm"
                icon="refresh"
                onClick={() => void runDetect()}
                disabled={detecting}
              >
                {detecting ? "Detecting…" : "Re-detect"}
              </Btn>
              {currentCli && (
                <Btn variant="ghost" size="sm" onClick={() => void selectCli(null)}>
                  Clear (auto-detect next ship)
                </Btn>
              )}
              {detectError && (
                <span
                  role="alert"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--status-failed)",
                  }}
                >
                  {detectError}
                </span>
              )}
            </div>
            {detection && noneInstalled(detection) && (
              <div
                role="status"
                style={{
                  marginTop: 4,
                  padding: "10px 12px",
                  borderRadius: 7,
                  background: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--status-failed) 40%, transparent)",
                  color: "var(--text)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                None of the supported CLIs were found on your PATH. Install one
                of them, or use the manual-message bypass that appears when
                Ship fails.
              </div>
            )}
          </div>
        </Field>
      </SettingsSection>
    </>
  );
}

function noneInstalled(detection: CommitCliDetection): boolean {
  return COMMIT_CLI_VALUES.every((cli) => !detection[cli]);
}

function CliOption({
  cli,
  selected,
  installed,
  onSelect,
}: {
  cli: CommitCli;
  selected: boolean;
  installed: boolean | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        background: selected ? "var(--accent-dim)" : "var(--surface-0)",
        border: `1px solid ${selected ? "var(--accent-border)" : "var(--border)"}`,
        borderRadius: 7,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text)",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
            background: selected ? "var(--accent)" : "transparent",
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {COMMIT_CLI_LABEL[cli]}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {COMMIT_CLI_DESCRIPTION[cli]}
          </div>
        </div>
      </div>
      <InstallBadge installed={installed} />
    </button>
  );
}

function InstallBadge({ installed }: { installed: boolean | null }) {
  if (installed === null) {
    return (
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-faint)",
          padding: "2px 8px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        checking…
      </span>
    );
  }
  if (installed) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--accent)",
          padding: "2px 8px",
          borderRadius: 999,
          border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
          flexShrink: 0,
        }}
      >
        <Icon name="check" size={10} />
        installed
      </span>
    );
  }
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--text-dim)",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px dashed var(--border)",
        flexShrink: 0,
      }}
    >
      not found
    </span>
  );
}
