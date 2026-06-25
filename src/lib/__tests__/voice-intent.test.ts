import { describe, expect, it } from "vitest";
import {
  cleanTranscript,
  parseVoiceCommand,
  VOICE_COMMANDS,
  type VoiceProject,
  type VoiceScript,
} from "../voice-intent";
import {
  normalizeVoiceCommandAliases,
  type VoiceAliasCommandId,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";

const PROJECTS: VoiceProject[] = [
  { id: "p1", name: "Agentic Jumpstart" },
  { id: "p2", name: "Mission Control" },
  { id: "p3", name: "Landing Page" },
  { id: "o1", name: "Owl Tales" },
];

const SCRIPTS: VoiceScript[] = [
  { id: "s1", name: "deploy to prod" },
  { id: "s2", name: "seed database" },
];

const parse = (t: string) => parseVoiceCommand(t, PROJECTS, SCRIPTS);

const ALIASES: VoiceCommandAliases = normalizeVoiceCommandAliases({
  "switch-project": ["hop to"],
  "run-project": ["fire dev server"],
  "open-browser": ["show preview"],
  "open-diff": ["show me code changes"],
  ship: ["send it"],
  "run-script": ["run script"],
  "new-agent": ["ask", "ask the robot"],
});

describe("cleanTranscript", () => {
  it("strips leading filler, trailing politeness, and punctuation", () => {
    expect(cleanTranscript("please switch to my project, thanks")).toBe("switch to my project,");
    expect(cleanTranscript("Okay um, run it.")).toBe("run it");
    expect(cleanTranscript("  '  go to landing page  '  ")).toBe("go to landing page");
  });

  it("returns empty for blank / filler-only input", () => {
    expect(cleanTranscript("")).toBe("");
    expect(cleanTranscript("   ")).toBe("");
  });
});

describe('workflow: "open <project name>" (+ switch variations)', () => {
  it.each([
    ["open agentic jumpstart", "p1"],
    ["open my owl tales project", "o1"],
    ["open the mission control project", "p2"],
    ["open landing page", "p3"],
    ["switch to owl tales", "o1"],
    ["change to mission control", "p2"],
    ["go to agentic jumpstart", "p1"],
    ["jump to landing page", "p3"],
    ["navigate to owl tales", "o1"],
    ["take me to mission control", "p2"],
    ["owl tales", "o1"], // bare project name, no verb
    ["owl tales project", "o1"], // push-to-talk clipped the verb
    ["my agentic jumpstart project", "p1"],
  ])("%j -> switch to %s", (phrase, id) => {
    expect(parse(phrase)).toMatchObject({ kind: "switch-project", projectId: id });
  });

  it("resolves a homophone via phonetics (owl tails -> Owl Tales)", () => {
    expect(parse("open owl tails")).toMatchObject({ kind: "switch-project", projectId: "o1" });
  });

  it("reports no-match for an unknown project instead of spawning an agent", () => {
    expect(parse("open my quarterly taxes project")).toEqual({
      kind: "switch-no-match",
      query: "quarterly taxes",
    });
  });

  it("offers a picker when the spoken name is ambiguous", () => {
    const projects: VoiceProject[] = [
      { id: "a", name: "Owl Tales" },
      { id: "b", name: "Owl Park" },
      { id: "c", name: "Mission Control" },
    ];
    const cmd = parseVoiceCommand("open owl", projects);
    expect(cmd.kind).toBe("switch-ambiguous");
    if (cmd.kind === "switch-ambiguous") {
      expect(cmd.candidates.map((p) => p.id)).toEqual(expect.arrayContaining(["a", "b"]));
    }
  });
});

describe('workflow: "create new <claude|codex|cursor|opencode> agent to do <prompt>"', () => {
  it.each([
    ["create new claude agent to do improve the seo", "claude-code", "improve the seo"],
    ["create a codex agent to do add tests", "codex", "add tests"],
    ["create new cursor agent to do fix the bug", "cursor-cli", "fix the bug"],
    ["spawn an opencode agent to do refactor auth", "opencode", "refactor auth"],
    ["make a new claude code agent to do write the docs", "claude-code", "write the docs"],
    ["start a codex session to do run the migration", "codex", "run the migration"],
    ["new claude agent to do clean up tests", "claude-code", "clean up tests"],
    ["create a cursor cli agent that does audit deps", "cursor-cli", "audit deps"],
    // Direct prompt, no "to do" connector.
    ["use a codex agent fix the login bug", "codex", "fix the login bug"],
    ["start a cursor agent add a button", "cursor-cli", "add a button"],
    ["spin up a claude agent write tests", "claude-code", "write tests"],
    ["use an opencode agent refactor the parser", "opencode", "refactor the parser"],
  ])("%j -> %s agent, prompt %j", (phrase, agent, prompt) => {
    expect(parse(phrase)).toEqual({ kind: "new-agent", agent, prompt });
  });

  it.each([
    ["start a claude agent", "claude-code"],
    ["start a codex agent", "codex"],
    ["create a cursor agent", "cursor-cli"],
    ["spin up an opencode agent", "opencode"],
  ])("%j just starts the agent (empty prompt)", (phrase, agent) => {
    expect(parse(phrase)).toEqual({ kind: "new-agent", agent, prompt: "" });
  });

  it("tolerates a misheard agent word (claude -> cloud) and uses the default agent", () => {
    expect(parse("start a cloud agent")).toEqual({
      kind: "new-agent",
      agent: undefined,
      prompt: "",
    });
  });

  it("omits the agent type when unspecified (caller defaults per project)", () => {
    expect(parse("create an agent")).toEqual({ kind: "new-agent", agent: undefined, prompt: "" });
    expect(parse("create an agent to do deploy the build")).toEqual({
      kind: "new-agent",
      agent: undefined,
      prompt: "deploy the build",
    });
  });

  it("handles 'have claude …' phrasing", () => {
    expect(parse("have claude fix the login bug")).toEqual({
      kind: "new-agent",
      agent: "claude-code",
      prompt: "fix the login bug",
    });
  });

  it("does not let the 'to do' connector eat a task starting with 'do…' (download)", () => {
    expect(parse("create a codex agent to download the dataset")).toEqual({
      kind: "new-agent",
      agent: "codex",
      prompt: "download the dataset",
    });
  });
});

describe('workflow: "open the browser / app"', () => {
  it.each([
    "open the browser",
    "open the app",
    "open browser",
    "open app",
    "open in browser",
    "open it in the browser",
    "launch the app",
    "view the preview",
    "open the web app",
  ])("%j -> open-browser", (phrase) => {
    expect(parse(phrase)).toEqual({ kind: "open-browser" });
  });

  it("does not hijack 'open my app project' (stays a switch attempt)", () => {
    expect(parse("open my app project").kind).not.toBe("open-browser");
  });
});

describe('workflow: "ship it" / "commit & push"', () => {
  it.each([
    "ship it",
    "ship",
    "commit and push",
    "commit & push",
    "commit push",
    "commit",
    "push",
    "commit changes",
  ])("%j -> ship", (phrase) => {
    expect(parse(phrase)).toEqual({ kind: "ship" });
  });

  it("does not treat 'ship the new feature' as the ship command", () => {
    expect(parse("ship the new feature").kind).not.toBe("ship");
  });
});

describe('workflow: "open diff" / review changes', () => {
  it.each([
    "open diff",
    "open the diff",
    "open diff view",
    "open the diff view",
    "show changes",
    "review changes",
    "open changes",
    "show the diff",
  ])("%j -> open-diff", (phrase) => {
    expect(parse(phrase)).toEqual({ kind: "open-diff" });
  });
});

describe("run / stop the project", () => {
  it.each([
    "run the project",
    "run it",
    "run",
    "stop the project",
    "restart it",
    "launch the project",
  ])("%j -> run-project", (phrase) => {
    expect(parse(phrase)).toEqual({ kind: "run-project" });
  });
});

describe("run a custom script by name", () => {
  it.each([
    ["deploy to prod", "s1"],
    ["run deploy to prod", "s1"],
    ["seed database", "s2"],
  ])("%j -> run-script %s", (phrase, id) => {
    expect(parse(phrase)).toMatchObject({ kind: "run-script", scriptId: id });
  });

  it("does not run a script when none are configured", () => {
    // "seed database" isn't an action-verb phrase, so with no scripts it's just
    // unrecognized (not a run-script, not a default-agent task).
    expect(parseVoiceCommand("seed database", PROJECTS, []).kind).toBe("unrecognized");
  });
});

describe("custom voice command aliases", () => {
  it.each([
    ["send it", { kind: "ship" }],
    ["show me code changes", { kind: "open-diff" }],
    ["show preview", { kind: "open-browser" }],
    ["fire dev server", { kind: "run-project" }],
  ])("%j matches a fixed command alias", (phrase, expected) => {
    expect(parseVoiceCommand(phrase, PROJECTS, SCRIPTS, ALIASES)).toEqual(expected);
  });

  it("uses switch aliases as project-name prefixes", () => {
    expect(parseVoiceCommand("hop to mission control", PROJECTS, SCRIPTS, ALIASES)).toMatchObject({
      kind: "switch-project",
      projectId: "p2",
      query: "mission control",
    });
  });

  it("keeps switch-alias no-matches from spawning agents", () => {
    expect(parseVoiceCommand("hop to quarterly taxes", PROJECTS, SCRIPTS, ALIASES)).toEqual({
      kind: "switch-no-match",
      query: "quarterly taxes",
    });
  });

  it("uses run-script aliases as script-name prefixes", () => {
    expect(parseVoiceCommand("run script seed database", PROJECTS, SCRIPTS, ALIASES)).toMatchObject({
      kind: "run-script",
      scriptId: "s2",
    });
  });

  it("uses the longest matching agent alias and preserves the prompt casing", () => {
    expect(parseVoiceCommand("ask the robot Fix Login", PROJECTS, SCRIPTS, ALIASES)).toEqual({
      kind: "new-agent",
      prompt: "Fix Login",
    });
  });

  it("keeps built-in command priority when an alias collides", () => {
    const aliases = normalizeVoiceCommandAliases({ "run-project": ["ship"] });
    expect(parseVoiceCommand("ship", PROJECTS, SCRIPTS, aliases)).toEqual({ kind: "ship" });
  });
});

describe("freeform task -> default agent (no 'create an agent' needed)", () => {
  it.each([
    "improve the seo on the landing page",
    "fix the login bug",
    "add a dark mode toggle",
    "refactor the auth module",
    "write tests for the parser",
    "set up eslint",
  ])("%j -> new-agent with no explicit agent (caller uses the default)", (phrase) => {
    const cmd = parse(phrase);
    expect(cmd).toEqual({ kind: "new-agent", prompt: phrase });
    if (cmd.kind === "new-agent") expect(cmd.agent).toBeUndefined();
  });
});

describe("unrecognized — noise/filler never spawns an agent", () => {
  it.each([
    "yeah yeah yeah okay",
    "yeah, yeah, yeah, yeah, okay",
    "hello there",
    "um what was i saying",
    "the quick brown fox",
  ])("%j -> unrecognized", (phrase) => {
    expect(parse(phrase).kind).toBe("unrecognized");
  });

  it("returns empty for blank input", () => {
    expect(parse("").kind).toBe("empty");
    expect(parse("   ").kind).toBe("empty");
  });
});

describe("VOICE_COMMANDS catalog (Settings page source of truth)", () => {
  it("documents every actionable command kind so the page can't drift", () => {
    const documented = new Set(VOICE_COMMANDS.map((c) => c.id));
    const actionable: VoiceAliasCommandId[] = [
      "switch-project",
      "run-project",
      "open-browser",
      "open-diff",
      "ship",
      "run-script",
      "new-agent",
    ];
    for (const kind of actionable) expect(documented.has(kind)).toBe(true);
  });

  it("gives every command at least one example", () => {
    for (const cmd of VOICE_COMMANDS) expect(cmd.examples.length).toBeGreaterThan(0);
  });
});
