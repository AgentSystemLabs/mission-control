// Deterministic, LLM-free parser that maps a spoken transcript to a Mission
// Control command. Speed is the point: this runs in the hot path right after
// transcription, so it is pure string work + a fuzzy project match — no network.
//
// Recognized intents (checked in order): explicit new-agent, run/stop project,
// switch project (verb-led OR a bare project name). Anything that matches none of
// these is "unrecognized" — we deliberately do NOT spawn an agent on arbitrary
// speech, so noise/filler ("yeah yeah okay") can't start work.

import type { TaskAgent } from "~/shared/domain";
import {
  normalizeVoiceAliasPhrase,
  sortedVoiceAliasesFor,
  type VoiceAliasCommandId,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";
import { matchProjects } from "./project-match";

export type VoiceProject = { id: string; name: string };
export type VoiceScript = { id: string; name: string };

export type VoiceCommand =
  | { kind: "switch-project"; projectId: string; projectName: string; query: string }
  | { kind: "switch-ambiguous"; query: string; candidates: VoiceProject[] }
  | { kind: "switch-no-match"; query: string }
  | { kind: "run-project" }
  | { kind: "open-browser" }
  | { kind: "open-diff" }
  | { kind: "ship" }
  | { kind: "run-script"; scriptId: string; scriptName: string }
  | { kind: "new-agent"; prompt: string; agent?: TaskAgent }
  | { kind: "unrecognized"; transcript: string }
  | { kind: "empty" };

const LEADING_FILLER =
  /^(?:please|hey|ok|okay|um+|uh+|so|now|alright|yo|just|go ahead and|i (?:want|wanna|need|would like) (?:to|you to)|i'?d like (?:to|you to)|can you|could you|would you|will you|let'?s|let us)[,.;:]?\s+/i;
const TRAILING_FILLER = /\s+(?:please|thanks|thank you|now|for me)$/i;

const SWITCH_RE =
  /^(?:switch|change|jump|go|open|navigate|take me)\s+(?:over\s+)?(?:to\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+projects?)?$/i;
const RUN_RE =
  /^(?:run|start|launch|relaunch|restart|boot|stop|kill)\s+(?:the\s+)?(?:current\s+)?(?:projects?|app|it|this|them|dev(?:\s+server)?|server|launch(?:\s+commands?)?)\b/i;
const RUN_BARE_RE = /^(?:run|stop|relaunch|restart)$/i;
// "open the browser", "open the app", "open in browser", "view the preview", …
// Noun anchored to end of phrase so "open my app project" stays a switch.
const OPEN_BROWSER_RE =
  /^(?:open|launch|view|show|bring up|pull up|go to)\s+(?:it\s+)?(?:up\s+)?(?:in\s+)?(?:the\s+|my\s+)?(?:browser|app|web ?app|preview|localhost)\s*$/i;
// "ship it", "commit and push", "commit & push", "push", "commit changes", …
const SHIP_RE =
  /^(?:ship(?:\s+it)?|commit(?:\s+(?:and\s+|&\s+|\+\s+|n\s+)?push)?(?:\s+changes)?|push(?:\s+it)?)\s*$/i;
// "open diff", "open the diff view", "show changes", "review changes", …
const DIFF_RE =
  /^(?:open|show|view|toggle|go to)\s+(?:the\s+)?(?:diff(?:\s+view)?|changes|review(?:\s+changes)?)\s*$|^review\s+changes\s*$/i;
// Leading verb to ignore when matching a spoken phrase against custom-script names.
const SCRIPT_VERB_PREFIX = /^(?:run|execute|exec|do|start)\s+/i;
// Group 1 = agent type (optional: claude|codex|cursor|opencode), group 2 = task.
// The connector consumes "to do"/"that does" (with \b so "download" isn't eaten).
// Group 1 = agent type, group 2 = task. The optional `(?!agent…)\w+` tolerates a
// stray/misheard word before "agent" (e.g. whisper hears "claude" as "cloud") so
// "start a <something> agent" still creates a session — defaulting the agent type.
const NEW_AGENT_RE =
  /^(?:create|spawn|make|start|new|launch|fire up|kick off|spin up|boot up|use|open|add|build)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:(claude(?:\s+code)?|codex|cursor(?:\s+cli)?|opencode)\s+)?(?:(?!agent\b|session\b|task\b)\w+\s+)?(?:agent|session|task)\b\s*(?:to(?:\s+do\b)?|that(?:\s+does\b)?|which|who|for|:)?\s*(.*)$/i;
const HAVE_CLAUDE_RE =
  /^(?:have|tell|ask|get|let)\s+(?:claude|the agent|an? agent)\s+(?:to\s+)?(.+)$/i;
// A freeform instruction (no "agent" keyword) that should spin up the default
// agent. Curated action verbs so it reads as a task, not noise/filler — and it
// must have content after the verb (≥ 2 tokens). Builtin command verbs (open,
// run, ship, commit, switch, …) are intentionally excluded; they're handled above.
const TASK_VERB_RE =
  /^(?:improve|fix|add|remove|delete|update|refactor|rewrite|build|write|create|make|implement|debug|optimize|clean(?:\s*up)?|rename|configure|install|set\s*up|test|review|document|generate|change|convert|migrate|upgrade|bump|wire|integrate|handle|support|enable|disable|replace|extract|split|merge|investigate|research|summarize|explain|analyze|audit|draft|design|scaffold|port|translate|check|validate|verify|ensure|polish|format|lint|deploy|publish|work on|look into|figure out)\s+\S+/i;

// Map a spoken agent name to its TaskAgent id.
function mapAgent(raw: string | undefined): TaskAgent | undefined {
  if (!raw) return undefined;
  const a = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (a.startsWith("claude")) return "claude-code";
  if (a === "codex") return "codex";
  if (a.startsWith("cursor")) return "cursor-cli";
  if (a === "opencode") return "opencode";
  return undefined;
}

function matchesExactAlias(
  cleaned: string,
  aliases: VoiceCommandAliases | undefined,
  commandId: VoiceAliasCommandId,
): boolean {
  const normalized = normalizeVoiceAliasPhrase(cleaned);
  return sortedVoiceAliasesFor(aliases, commandId).some((alias) => alias === normalized);
}

function aliasPrefixRemainder(
  cleaned: string,
  aliases: VoiceCommandAliases | undefined,
  commandId: VoiceAliasCommandId,
): string | null {
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  for (const alias of sortedVoiceAliasesFor(aliases, commandId)) {
    const aliasTokens = alias.split(" ");
    if (tokens.length < aliasTokens.length) continue;
    const candidate = tokens.slice(0, aliasTokens.length).join(" ");
    if (normalizeVoiceAliasPhrase(candidate) !== alias) continue;
    return tokens.slice(aliasTokens.length).join(" ").trim();
  }
  return null;
}

function resolveProjectSwitch(
  query: string,
  projects: VoiceProject[],
  looksLikeSwitch: boolean,
): VoiceCommand | null {
  if (!query) return null;
  const result = matchProjects(query, projects, (p) => p.name);
  if (result.best) {
    // Act on a confident match always; on a sole/ambiguous match only when the
    // user clearly signalled a switch (a verb, a custom alias, or trailing "project").
    if (result.confident) {
      return {
        kind: "switch-project",
        projectId: result.best.item.id,
        projectName: result.best.item.name,
        query,
      };
    }
    if (looksLikeSwitch) {
      if (result.candidates.length >= 2) {
        return { kind: "switch-ambiguous", query, candidates: result.candidates.map((c) => c.item) };
      }
      return {
        kind: "switch-project",
        projectId: result.best.item.id,
        projectName: result.best.item.name,
        query,
      };
    }
    // Weak match with no switch signal → likely a task; fall through.
    return null;
  }
  if (looksLikeSwitch) {
    // Clearly a switch attempt but nothing matched — report it rather than
    // silently spawning an agent on the phrase.
    return { kind: "switch-no-match", query };
  }
  return null;
}

// Strip surrounding quotes/punctuation and conversational filler, preserving
// the inner casing so an extracted prompt reads naturally.
export function cleanTranscript(transcript: string): string {
  let s = transcript.replace(/[\s"'`]+$/g, "").replace(/^[\s"'`]+/g, "");
  s = s.replace(/[.!?]+$/g, "").trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(LEADING_FILLER, "");
  }
  prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(TRAILING_FILLER, "").trim();
  }
  return s.replace(/\s+/g, " ").trim();
}

export function parseVoiceCommand(
  transcript: string,
  projects: VoiceProject[],
  scripts: VoiceScript[] = [],
  aliases?: VoiceCommandAliases,
): VoiceCommand {
  const cleaned = cleanTranscript(transcript ?? "");
  if (!cleaned) return { kind: "empty" };

  // 1. Explicit "create an agent to X" / "have claude X" — these have
  //    unambiguous markers (an agent/session/task keyword, or "ask claude"), so
  //    resolve them first even though the task text may contain other verbs.
  const newAgentMatch = NEW_AGENT_RE.exec(cleaned);
  if (newAgentMatch) {
    return {
      kind: "new-agent",
      prompt: newAgentMatch[2].trim(),
      agent: mapAgent(newAgentMatch[1]),
    };
  }
  const haveClaudeMatch = HAVE_CLAUDE_RE.exec(cleaned);
  if (haveClaudeMatch) {
    return { kind: "new-agent", prompt: haveClaudeMatch[1].trim(), agent: "claude-code" };
  }

  // 2. Open the running app in the browser ("open the browser/app").
  if (OPEN_BROWSER_RE.test(cleaned)) {
    return { kind: "open-browser" };
  }

  // 3. Ship (commit + push) and the diff/review view.
  if (SHIP_RE.test(cleaned)) {
    return { kind: "ship" };
  }
  if (DIFF_RE.test(cleaned)) {
    return { kind: "open-diff" };
  }

  // 4. Run / stop the current project.
  if (RUN_RE.test(cleaned) || RUN_BARE_RE.test(cleaned)) {
    return { kind: "run-project" };
  }

  // 5. User-defined aliases for fixed commands. Built-ins above keep priority
  //    so aliases cannot accidentally redefine core phrases like "run" or "ship".
  if (matchesExactAlias(cleaned, aliases, "run-project")) {
    return { kind: "run-project" };
  }
  if (matchesExactAlias(cleaned, aliases, "open-browser")) {
    return { kind: "open-browser" };
  }
  if (matchesExactAlias(cleaned, aliases, "ship")) {
    return { kind: "ship" };
  }
  if (matchesExactAlias(cleaned, aliases, "open-diff")) {
    return { kind: "open-diff" };
  }

  // 6. User-defined aliases for commands that take a following phrase.
  const customAgentPrompt = aliasPrefixRemainder(cleaned, aliases, "new-agent");
  if (customAgentPrompt !== null) {
    return { kind: "new-agent", prompt: customAgentPrompt };
  }

  const customScriptQuery = aliasPrefixRemainder(cleaned, aliases, "run-script");
  if (customScriptQuery && scripts.length > 0) {
    const scriptMatch = matchProjects(customScriptQuery, scripts, (s) => s.name);
    if (scriptMatch.best && scriptMatch.confident) {
      return {
        kind: "run-script",
        scriptId: scriptMatch.best.item.id,
        scriptName: scriptMatch.best.item.name,
      };
    }
  }

  const customSwitchQuery = aliasPrefixRemainder(cleaned, aliases, "switch-project");
  if (customSwitchQuery) {
    const switchCommand = resolveProjectSwitch(customSwitchQuery, projects, true);
    if (switchCommand) return switchCommand;
  }

  // 7. Run a custom script by name for the current project ("deploy to prod").
  //    Confident-only so an offhand phrase can't trigger a side-effecting run.
  if (scripts.length > 0) {
    const scriptQuery = cleaned.replace(SCRIPT_VERB_PREFIX, "").trim();
    const scriptMatch = matchProjects(scriptQuery, scripts, (s) => s.name);
    if (scriptMatch.best && scriptMatch.confident) {
      return {
        kind: "run-script",
        scriptId: scriptMatch.best.item.id,
        scriptName: scriptMatch.best.item.name,
      };
    }
  }

  // 8. Switch project. We accept BOTH verb-led phrasing ("go to X") AND a bare
  //    project reference ("owl tales", "owl tales project") — push-to-talk often
  //    clips the leading verb, and that must never fall through to spawning an
  //    agent. `endsWithProject` is the trailing-qualifier signal (distinct from
  //    "project" appearing mid-sentence in a task).
  const switchMatch = SWITCH_RE.exec(cleaned);
  const endsWithProject = /\bprojects?\s*$/i.test(cleaned);
  const query = (
    switchMatch
      ? switchMatch[1]
      : cleaned.replace(/^(?:my|the)\s+/i, "").replace(/\s+projects?$/i, "")
  ).trim();
  const switchCommand = resolveProjectSwitch(query, projects, !!switchMatch || endsWithProject);
  if (switchCommand) return switchCommand;

  // 9. Freeform task → default agent, even without "create an agent". Only when
  //    it reads like an instruction (starts with an action verb); pure noise or
  //    filler ("yeah yeah okay") stays unrecognized so it never spawns work.
  if (TASK_VERB_RE.test(cleaned)) {
    return { kind: "new-agent", prompt: cleaned };
  }

  return { kind: "unrecognized", transcript: cleaned };
}

// Human-facing catalog of supported voice commands. SINGLE SOURCE OF TRUTH for
// the Settings → Voice Commands page — add an entry here when you add a command
// and the page updates automatically. (A test asserts every actionable command
// kind has an entry so this can't silently drift.)
export type VoiceCommandDoc = {
  /** Stable id matching the related VoiceCommand `kind`(s), for the sync test. */
  id: VoiceAliasCommandId;
  title: string;
  description: string;
  examples: string[];
};

export const VOICE_COMMANDS: VoiceCommandDoc[] = [
  {
    id: "switch-project",
    title: "Switch project",
    description: "Jump to another project by name (matched by sound and spelling).",
    examples: ["open agentic jumpstart", "switch to mission control", "go to owl tales"],
  },
  {
    id: "run-project",
    title: "Run or stop the project",
    description: "Start the project's launch commands, or stop them if running.",
    examples: ["run the project", "run it", "stop the project"],
  },
  {
    id: "open-browser",
    title: "Open in browser",
    description: "Open the running app's URL in your default browser.",
    examples: ["open the browser", "open the app", "open in browser"],
  },
  {
    id: "open-diff",
    title: "Review changes",
    description: "Open the git diff / review-changes view.",
    examples: ["open diff", "review changes", "show changes"],
  },
  {
    id: "ship",
    title: "Ship (commit & push)",
    description: "Commit and push the current changes.",
    examples: ["ship it", "commit and push", "push"],
  },
  {
    id: "run-script",
    title: "Run a custom script",
    description: "Run one of the current project's custom scripts by its name.",
    examples: ["deploy to prod", "run <your script name>"],
  },
  {
    id: "new-agent",
    title: "Start an agent",
    description:
      "Spin up an agent on a task. Name the agent (claude, codex, cursor, opencode) or omit it to use your default. You can also just say the task.",
    examples: [
      "create a claude agent to do add tests",
      "use a codex agent fix the login bug",
      "improve the seo on the landing page",
    ],
  },
];
