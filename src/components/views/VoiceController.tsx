// App-wide voice control. Mounted once at the root. Hold the push-to-talk key
// to record; on release the clip is transcribed locally (whisper) and routed
// through a keyword heuristic to a Mission Control command — switch project, run
// the project, or start an agent on a spoken task. No LLM in the hot path.

import { useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { getElectron, isElectron } from "~/lib/electron";
import { useProjects, useSettings } from "~/queries";
import { parseCustomScripts } from "~/shared/domain";
import { parseVoiceCommand, type VoiceProject } from "~/lib/voice-intent";
import { usePushToTalk } from "~/lib/use-push-to-talk";
import { startRecording, type VoiceRecording } from "~/lib/voice-capture";
import { playVoiceCue } from "~/lib/voice-sound";
import {
  emptyVoiceCommandAliases,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";
import {
  dispatchVoicePasteToFocusedSession,
  dispatchVoiceNewAgent,
  dispatchVoiceOpenBrowser,
  dispatchVoiceOpenDiff,
  dispatchVoiceRemember,
  dispatchVoiceRunProject,
  dispatchVoiceRunScript,
  dispatchVoiceShip,
  VOICE_PTT_START_EVENT,
  VOICE_PTT_STOP_EVENT,
  VOICE_PTT_CANCEL_EVENT,
} from "~/lib/voice-events";
import { isSessionTerminalXtermFocused } from "~/lib/terminal-pane-helpers";
import { RecordingIndicator, type VoiceStatus } from "./RecordingIndicator";
import { VoiceDisambiguation } from "./VoiceDisambiguation";

const WHISPER_UNAVAILABLE_MESSAGE =
  "Voice control is missing its bundled Whisper resources. Reinstall or update Mission Control.";

function activeProjectId(pathname: string): string | null {
  return /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

// Prime whisper toward the user's project names + command vocabulary so it
// transcribes "OwlTales" instead of "owl tails". whisper caps the prompt
// context, so keep it short — names first (most valuable), then command shape.
function buildBiasPrompt(
  projects: VoiceProject[] | undefined,
  aliases: VoiceCommandAliases | undefined,
): string {
  const names = (projects ?? [])
    .map((p) => p.name)
    .filter(Boolean)
    .slice(0, 40);
  const customPhrases = Object.values(aliases ?? {})
    .flat()
    .filter(Boolean)
    .slice(0, 30);
  const namePart = names.length ? `Project names: ${names.join(", ")}.` : "";
  const aliasPart = customPhrases.length ? `Custom command phrases: ${customPhrases.join(", ")}.` : "";
  return `${namePart} ${aliasPart} Agents: claude, codex, cursor, opencode. Commands: open a project, run the project, ship it, open the diff, start a claude or codex agent to do a task.`.trim();
}

export function VoiceController() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const voiceCommandAliases = settings?.voiceCommandAliases ?? emptyVoiceCommandAliases();

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const available = useRef(false);
  const recorderRef = useRef<VoiceRecording | null>(null);
  const startingRef = useRef<Promise<VoiceRecording> | null>(null);
  // Bumped on every begin/abort so a stale in-flight transcription can't clobber
  // the status or fire a command for a session the user already moved past.
  const sessionGen = useRef(0);
  const [disambiguation, setDisambiguation] = useState<{
    query: string;
    candidates: VoiceProject[];
  } | null>(null);

  // Latest values for the stable push-to-talk callbacks.
  const ctx = useRef({ projects, pathname, voiceCommandAliases });
  ctx.current = { projects, pathname, voiceCommandAliases };

  // Experimental: gated behind Settings → Experimental → Voice control.
  const enabled = isElectron() && (settings?.voiceControlEnabled ?? false);

  useEffect(() => {
    if (!enabled) return;
    const electron = getElectron();
    if (!electron) return;
    let cancelled = false;
    void electron.voice
      .available()
      .then((ok) => {
        if (cancelled) return;
        available.current = ok;
        // Warm the model so the first real command isn't slowed by model load.
        if (ok) void electron.voice.prewarm();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const goToProject = (projectId: string, projectName: string) => {
    void router.navigate({ to: "/projects/$id", params: { id: projectId } });
    toast.success(`Switched to ${projectName}`);
  };

  const runCommand = (text: string) => {
    const projects = ctx.current.projects ?? [];
    const current = projects.find((p) => p.id === activeProjectId(ctx.current.pathname));
    const scripts = parseCustomScripts(current?.customScripts ?? null).map((s) => ({
      id: s.id,
      name: s.name,
    }));
    const sessionInputFocused = isSessionTerminalXtermFocused();
    const command = parseVoiceCommand(text, projects, scripts, ctx.current.voiceCommandAliases, {
      allowFreeformTask: !sessionInputFocused,
    });
    switch (command.kind) {
      case "empty":
        toast.info("Didn't catch that — try again.");
        return;
      case "switch-project":
        goToProject(command.projectId, command.projectName);
        return;
      case "switch-ambiguous":
        setDisambiguation({ query: command.query, candidates: command.candidates });
        return;
      case "switch-no-match":
        toast.error(`No project matching “${command.query}”`);
        return;
      case "run-project":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first to run it.");
          return;
        }
        dispatchVoiceRunProject();
        toast.success("Running the project");
        return;
      case "open-browser":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first.");
          return;
        }
        dispatchVoiceOpenBrowser();
        toast.success("Opening in browser");
        return;
      case "run-script":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first.");
          return;
        }
        dispatchVoiceRunScript(command.scriptId);
        toast.success(`Running “${command.scriptName}”`);
        return;
      case "open-diff":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first.");
          return;
        }
        dispatchVoiceOpenDiff();
        toast.success("Opening changes");
        return;
      case "ship":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first to ship.");
          return;
        }
        dispatchVoiceShip();
        toast.success("Shipping…");
        return;
      case "new-agent":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first to start an agent.");
          return;
        }
        dispatchVoiceNewAgent(command.prompt, command.agent);
        toast.success(
          command.prompt ? `Starting agent: “${command.prompt}”` : "Starting a new agent",
        );
        return;
      case "remember":
        if (!activeProjectId(ctx.current.pathname)) {
          toast.error("Open a project first to remember something.");
          return;
        }
        dispatchVoiceRemember(command.text);
        return;
      case "unrecognized":
        if (sessionInputFocused) {
          const transcript = text.trim();
          if (transcript && dispatchVoicePasteToFocusedSession(transcript)) return;
          toast.info("Focused session isn't ready for voice input yet.");
          return;
        }
        // Never spawn an agent on arbitrary speech — tell the user what to say.
        toast.info('Didn\'t catch a command. Try "open <project>" or "create an agent to <task>".');
        return;
    }
  };

  const begin = async () => {
    const electron = getElectron();
    sessionGen.current += 1;
    const gen = sessionGen.current;
    setDisambiguation(null);
    if (!available.current) {
      toast.error(WHISPER_UNAVAILABLE_MESSAGE);
      void electron?.voice.available().then((ok) => (available.current = ok));
      return;
    }
    setStatus("recording");
    try {
      const starting = startRecording();
      startingRef.current = starting;
      recorderRef.current = await starting;
      if (gen === sessionGen.current) playVoiceCue("start");
    } catch {
      startingRef.current = null;
      setStatus("idle");
      toast.error("Couldn't access the microphone.");
    }
  };

  const finish = async () => {
    const gen = sessionGen.current;
    const live = () => gen === sessionGen.current;
    // If the key was released before capture finished starting, wait for it.
    if (!recorderRef.current && startingRef.current) {
      recorderRef.current = await startingRef.current.catch(() => null);
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    startingRef.current = null;
    if (!recorder) {
      if (live()) setStatus("idle");
      return;
    }
    if (live()) setStatus("transcribing");
    try {
      const wav = await recorder.stop();
      if (!live()) return;
      playVoiceCue("end");
      const electron = getElectron();
      const result = await electron?.voice.transcribe(
        wav,
        buildBiasPrompt(ctx.current.projects, ctx.current.voiceCommandAliases),
      );
      // A newer push-to-talk started while we were transcribing — drop this one.
      if (!live()) return;
      setStatus("idle");
      if (!result) return;
      if (!result.ok) {
        toast.error(
          result.code === "unavailable"
            ? WHISPER_UNAVAILABLE_MESSAGE
            : `Transcription failed: ${result.error}`,
        );
        return;
      }
      runCommand(result.text);
    } catch (err) {
      if (live()) setStatus("idle");
      toast.error(err instanceof Error ? err.message : "Voice command failed.");
    }
  };

  const abort = () => {
    sessionGen.current += 1;
    if (recorderRef.current) {
      recorderRef.current.cancel();
    } else if (startingRef.current) {
      // Start hadn't resolved yet — tear down the recorder once it does so the
      // mic stream doesn't leak (e.g. window blur mid-hold).
      void startingRef.current.then((r) => r.cancel()).catch(() => undefined);
    }
    recorderRef.current = null;
    startingRef.current = null;
    setStatus("idle");
  };

  usePushToTalk(
    { onStart: () => void begin(), onStop: () => void finish(), onCancel: abort },
    { enabled },
  );

  // The header mic button drives the exact same flow as the keybinding, but via
  // pointer hold instead of keydown — it dispatches PTT events that map here.
  const controls = useRef({ begin, finish, abort });
  controls.current = { begin, finish, abort };
  useEffect(() => {
    if (!enabled) return;
    const onStart = () => void controls.current.begin();
    const onStop = () => void controls.current.finish();
    const onCancel = () => controls.current.abort();
    window.addEventListener(VOICE_PTT_START_EVENT, onStart);
    window.addEventListener(VOICE_PTT_STOP_EVENT, onStop);
    window.addEventListener(VOICE_PTT_CANCEL_EVENT, onCancel);
    return () => {
      window.removeEventListener(VOICE_PTT_START_EVENT, onStart);
      window.removeEventListener(VOICE_PTT_STOP_EVENT, onStop);
      window.removeEventListener(VOICE_PTT_CANCEL_EVENT, onCancel);
    };
  }, [enabled]);

  return (
    <>
      <RecordingIndicator status={status} />
      {disambiguation && (
        <VoiceDisambiguation
          query={disambiguation.query}
          candidates={disambiguation.candidates}
          onSelect={(p) => {
            setDisambiguation(null);
            goToProject(p.id, p.name);
          }}
          onCancel={() => setDisambiguation(null)}
        />
      )}
    </>
  );
}
