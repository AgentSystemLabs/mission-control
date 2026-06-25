import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { SettingsSection } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { formatBinding } from "~/lib/keybindings/format";
import { useKeybindings } from "~/lib/keybindings/store";
import { VOICE_COMMANDS } from "~/lib/voice-intent";
import { queryKeys, useSettings } from "~/queries";
import {
  emptyVoiceCommandAliases,
  MAX_VOICE_ALIASES_PER_COMMAND,
  MAX_VOICE_ALIAS_LENGTH,
  normalizeVoiceAliasPhrase,
  normalizeVoiceCommandAliases,
  type VoiceAliasCommandId,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";

type Drafts = Record<VoiceAliasCommandId, string>;
type Errors = Partial<Record<VoiceAliasCommandId, string>>;

function emptyDrafts(): Drafts {
  return Object.fromEntries(VOICE_COMMANDS.map((cmd) => [cmd.id, ""])) as Drafts;
}

// Lists every supported voice command. Rendered straight from VOICE_COMMANDS in
// voice-intent.ts, so adding a command there updates this page automatically.
export function VoiceCommandsPage() {
  const queryClient = useQueryClient();
  const { bindings } = useKeybindings();
  const { data: settings } = useSettings();
  const hotkey = formatBinding(bindings["voice.pushToTalk"]);
  const [drafts, setDrafts] = useState<Drafts>(() => emptyDrafts());
  const [errors, setErrors] = useState<Errors>({});
  const aliases = settings?.voiceCommandAliases ?? emptyVoiceCommandAliases();
  const voiceEnabled = settings?.voiceControlEnabled ?? false;

  const updateAliases = async (nextAliases: VoiceCommandAliases) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const base = previous ?? settings;
    if (base) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, {
        ...base,
        voiceCommandAliases: nextAliases,
      });
    }
    try {
      const next = await api.updateSettings({ voiceCommandAliases: nextAliases });
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const setDraft = (commandId: VoiceAliasCommandId, value: string) => {
    setDrafts((current) => ({ ...current, [commandId]: value }));
    setErrors((current) => ({ ...current, [commandId]: undefined }));
  };

  const addAlias = (commandId: VoiceAliasCommandId, event: FormEvent) => {
    event.preventDefault();
    const alias = normalizeVoiceAliasPhrase(drafts[commandId]);
    if (!alias) return;
    if (alias.length > MAX_VOICE_ALIAS_LENGTH) {
      setErrors((current) => ({
        ...current,
        [commandId]: `Keep aliases under ${MAX_VOICE_ALIAS_LENGTH} characters.`,
      }));
      return;
    }
    if (aliases[commandId].includes(alias)) {
      setErrors((current) => ({ ...current, [commandId]: "That alias already exists." }));
      return;
    }
    if (aliases[commandId].length >= MAX_VOICE_ALIASES_PER_COMMAND) {
      setErrors((current) => ({
        ...current,
        [commandId]: `Limit is ${MAX_VOICE_ALIASES_PER_COMMAND} aliases per command.`,
      }));
      return;
    }

    const nextAliases = normalizeVoiceCommandAliases({
      ...aliases,
      [commandId]: [...aliases[commandId], alias],
    });
    setDrafts((current) => ({ ...current, [commandId]: "" }));
    void updateAliases(nextAliases).catch((error) => {
      setErrors((current) => ({
        ...current,
        [commandId]: error instanceof Error ? error.message : "Could not save alias.",
      }));
    });
  };

  const removeAlias = (commandId: VoiceAliasCommandId, alias: string) => {
    const nextAliases = normalizeVoiceCommandAliases({
      ...aliases,
      [commandId]: aliases[commandId].filter((value) => value !== alias),
    });
    void updateAliases(nextAliases).catch((error) => {
      setErrors((current) => ({
        ...current,
        [commandId]: error instanceof Error ? error.message : "Could not remove alias.",
      }));
    });
  };

  return (
    <SettingsSection
      title="Voice commands"
      subtitle={`Hold ${hotkey} and speak, then release to run. Spoken commands and custom aliases run locally.`}
      headingLevel="h1"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!voiceEnabled && (
          <div
            role="status"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--text)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Voice control is experimental and currently <strong>off</strong>. Enable it in
            Settings → Experimental → Voice control.
          </div>
        )}
        {VOICE_COMMANDS.map((cmd) => (
          <form
            key={cmd.id}
            onSubmit={(event) => addAlias(cmd.id, event)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{cmd.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
              {cmd.description}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cmd.examples.map((example) => (
                <span
                  key={example}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--text)",
                    background: "var(--surface-1, var(--surface-0))",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "3px 9px",
                  }}
                >
                  &ldquo;{example}&rdquo;
                </span>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                Custom phrases
              </div>
              {aliases[cmd.id].length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {aliases[cmd.id].map((alias) => (
                    <span
                      key={alias}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text)",
                        background: "var(--accent-dim)",
                        border: "1px solid var(--accent-border)",
                        borderRadius: 999,
                        padding: "3px 6px 3px 9px",
                      }}
                    >
                      &ldquo;{alias}&rdquo;
                      <button
                        type="button"
                        onClick={() => removeAlias(cmd.id, alias)}
                        aria-label={`Remove ${alias}`}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                          lineHeight: 1,
                          padding: "0 2px",
                        }}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  No custom phrases yet.
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={drafts[cmd.id]}
                  onChange={(event) => setDraft(cmd.id, event.target.value)}
                  placeholder={
                    cmd.id === "switch-project"
                      ? "e.g. hop to"
                      : cmd.id === "new-agent"
                        ? "e.g. tell the agent"
                        : "e.g. custom phrase"
                  }
                  aria-label={`Add custom phrase for ${cmd.title}`}
                  maxLength={MAX_VOICE_ALIAS_LENGTH + 1}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "7px 9px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--surface-1, var(--surface-0))",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                  }}
                />
                <Btn type="submit" variant="ghost" size="sm">
                  Add
                </Btn>
              </div>
              {errors[cmd.id] && (
                <div role="alert" style={{ fontSize: 11.5, color: "var(--status-failed)" }}>
                  {errors[cmd.id]}
                </div>
              )}
            </div>
          </form>
        ))}
      </div>
    </SettingsSection>
  );
}
