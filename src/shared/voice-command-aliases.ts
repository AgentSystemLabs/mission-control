export const VOICE_ALIAS_COMMAND_IDS = [
  "switch-project",
  "run-project",
  "open-browser",
  "open-diff",
  "ship",
  "run-script",
  "new-agent",
] as const;

export type VoiceAliasCommandId = (typeof VOICE_ALIAS_COMMAND_IDS)[number];
export type VoiceCommandAliases = Record<VoiceAliasCommandId, string[]>;

export const MAX_VOICE_ALIASES_PER_COMMAND = 12;
export const MAX_VOICE_ALIAS_LENGTH = 80;

export function emptyVoiceCommandAliases(): VoiceCommandAliases {
  return {
    "switch-project": [],
    "run-project": [],
    "open-browser": [],
    "open-diff": [],
    ship: [],
    "run-script": [],
    "new-agent": [],
  };
}

export function isVoiceAliasCommandId(value: string): value is VoiceAliasCommandId {
  return VOICE_ALIAS_COMMAND_IDS.includes(value as VoiceAliasCommandId);
}

export function normalizeVoiceAliasPhrase(value: string): string {
  return value
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeVoiceCommandAliases(value: unknown): VoiceCommandAliases {
  const aliases = emptyVoiceCommandAliases();
  if (value === null || value === undefined) return aliases;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("voiceCommandAliases must be an object");
  }

  for (const [commandId, rawAliases] of Object.entries(value)) {
    if (!isVoiceAliasCommandId(commandId)) {
      throw new Error(`unknown voice command alias id: ${commandId}`);
    }
    if (!Array.isArray(rawAliases)) {
      throw new Error(`voice aliases for ${commandId} must be an array`);
    }

    const seen = new Set<string>();
    for (const rawAlias of rawAliases) {
      if (typeof rawAlias !== "string") {
        throw new Error(`voice aliases for ${commandId} must be strings`);
      }
      const alias = normalizeVoiceAliasPhrase(rawAlias);
      if (!alias) continue;
      if (alias.length > MAX_VOICE_ALIAS_LENGTH) {
        throw new Error(`voice aliases must be ${MAX_VOICE_ALIAS_LENGTH} characters or fewer`);
      }
      if (seen.has(alias)) continue;
      seen.add(alias);
      aliases[commandId].push(alias);
      if (aliases[commandId].length > MAX_VOICE_ALIASES_PER_COMMAND) {
        throw new Error(
          `voice aliases are limited to ${MAX_VOICE_ALIASES_PER_COMMAND} per command`,
        );
      }
    }
  }

  return aliases;
}

export function sortedVoiceAliasesFor(
  aliases: VoiceCommandAliases | undefined,
  commandId: VoiceAliasCommandId,
): string[] {
  return [...(aliases?.[commandId] ?? [])].sort((a, b) => b.length - a.length);
}
