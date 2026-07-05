import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import { RuntimeDefaultControl, modelForSelectedHarness } from "./DefaultsSettingsPage";

type RecallSettingsPatch = Partial<
  Pick<
    AppSettings,
    | "recallEnabled"
    | "recallAutoCaptureEnabled"
    | "recallEngineEnabled"
    | "recallEngineHarness"
    | "recallEngineModel"
    | "recallAgentWriteEnabled"
    | "recallInjectBriefEnabled"
    | "recallCodeGraphEnabled"
    | "recallProactiveRecallEnabled"
  >
>;

// Recall has its own settings page under the Beta group. The first toggle is
// the master switch: when off, the server reports every sub-flag as false
// (stored values survive for re-enable), the detail toggles below are hidden,
// and the project menu drops its Recall entry.
export function RecallSettings() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();

  const recallEnabled = settings?.recallEnabled ?? true;
  const autoCapture = settings?.recallAutoCaptureEnabled ?? true;
  const engineEnabled = settings?.recallEngineEnabled ?? true;
  const engineHarness = settings?.recallEngineHarness ?? "claude-code";
  const engineModel = settings?.recallEngineModel ?? null;
  const agentWrite = settings?.recallAgentWriteEnabled ?? true;
  const injectBrief = settings?.recallInjectBriefEnabled ?? true;
  const codeGraph = settings?.recallCodeGraphEnabled ?? true;
  const proactiveRecall = settings?.recallProactiveRecallEnabled ?? true;

  const [updating, setUpdating] = useState(false);
  const inFlight = useRef(false);

  const update = async (patch: RecallSettingsPatch) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setUpdating(true);
    await queryClient.cancelQueries({ queryKey: queryKeys.settings });
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
    }
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      toast.error(e instanceof Error ? e.message : "Could not update Recall settings");
    } finally {
      inFlight.current = false;
      setUpdating(false);
    }
  };

  return (
    <>
      <Field label="Recall">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ToggleRow
            title="Recall project memory"
            description="Build curated project memory and a code graph per project, and hand them to new agent sessions. Turning this off disables all Recall behavior and removes Recall from the project menu."
            label="Enable"
            checked={recallEnabled}
            disabled={updating}
            onChange={(next) => void update({ recallEnabled: next })}
          />
          {recallEnabled && (
            <>
              <ToggleRow
                title="Inject Session Brief on start"
                description="Write curated project memory into the agent's auto-load file before a fresh session starts, so it doesn't rediscover the project."
                label="Inject Session Brief on start"
                checked={injectBrief}
                disabled={updating}
                onChange={(next) => void update({ recallInjectBriefEnabled: next })}
              />
              <ToggleRow
                title="Surface relevant memory each turn"
                description="Before the agent answers, inject the memories and code-graph symbols most relevant to the prompt — so it uses what Recall already knows without having to search first."
                label="Surface relevant memory each turn"
                checked={proactiveRecall}
                disabled={updating}
                onChange={(next) => void update({ recallProactiveRecallEnabled: next })}
              />
              <ToggleRow
                title="Auto-capture from finished sessions"
                description="When a session finishes, distill it into a few durable, typed memories (deduped and tagged “inferred”). Needs the Recall engine below."
                label="Auto-capture from finished sessions"
                checked={autoCapture}
                disabled={updating || !engineEnabled}
                onChange={(next) => void update({ recallAutoCaptureEnabled: next })}
              />
              <ToggleRow
                title="Allow agents to write memories"
                description="Let an agent session save decisions and discoveries back to this project's Recall via the API."
                label="Allow agents to write memories"
                checked={agentWrite}
                disabled={updating}
                onChange={(next) => void update({ recallAgentWriteEnabled: next })}
              />
              <ToggleRow
                title="Include the code graph in the brief"
                description="When a project's code graph is indexed, lead the Session Brief with an “Architecture at a glance” — the most-connected modules and entry points — so agents orient before diving in."
                label="Include the code graph in the brief"
                checked={codeGraph}
                disabled={updating}
                onChange={(next) => void update({ recallCodeGraphEnabled: next })}
              />
            </>
          )}
        </div>
      </Field>
      {recallEnabled && (
        <Field label="Recall engine">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ToggleRow
              title="Enable the Recall engine"
              description="Runs the connected agent CLI to distill, dedupe, and re-rank. When off, Recall still works with deterministic FTS + heuristic ranking, but nothing is auto-captured."
              label="Enable the Recall engine"
              checked={engineEnabled}
              disabled={updating}
              onChange={(next) => void update({ recallEngineEnabled: next })}
            />
            {engineEnabled && (
              <div
                style={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 16,
                }}
              >
                <RuntimeDefaultControl
                  agent={engineHarness}
                  model={engineModel}
                  disabled={updating}
                  onAgentSelect={(agent) =>
                    void update({
                      recallEngineHarness: agent,
                      recallEngineModel: modelForSelectedHarness(agent, engineModel),
                    })
                  }
                  onModelSelect={(model) => void update({ recallEngineModel: model })}
                />
              </div>
            )}
          </div>
        </Field>
      )}
    </>
  );
}

// Standalone Recall settings page rendered from its own sidebar entry under the
// Beta group, alongside Experimental.
export function RecallSettingsPage() {
  return (
    <SettingsSection
      title="Recall"
      subtitle="Curated project memory and a code graph fed to new agent sessions. May change or be removed."
      headingLevel="h1"
    >
      <RecallSettings />
    </SettingsSection>
  );
}
