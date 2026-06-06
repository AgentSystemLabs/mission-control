import {
  formatPathForTerminalPaste,
  isProjectPathDrag,
  readProjectPathFromDragEvent,
} from "./project-path-drag";
import { getElectron } from "./electron";
import {
  mapTerminalKey,
  shouldSuppressTerminalKey,
  terminalClipboardAction,
} from "./terminal-keymap";
import type { TaskStatus } from "~/shared/domain";

type Electron = NonNullable<ReturnType<typeof getElectron>>;

type TerminalLike = {
  focus(): void;
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void;
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  paste(data: string): void;
};

const TERMINAL_IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif|bmp)$/i;
const TERMINAL_IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|bmp)$/i;
const TERMINAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const TERMINAL_DROP_MAX_FILES = 10;

const ANSI_ESCAPE_REGEX =
  /(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[PX^_].*?(?:\x1b\\)|\x1b[@-_])/g;

export function stripTerminalSelectionFormatting(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, "");
}

/** True when keyboard focus is inside an xterm surface in the bottom user terminal panel. */
export function isUserTerminalXtermFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (!el.closest("[data-user-terminal-panel]")) return false;
  return !!el.closest(".xterm");
}

/** True when keyboard focus is inside an xterm surface in the session terminal panel. */
export function isSessionTerminalXtermFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (!el.closest("[data-session-terminal-panel]")) return false;
  return !!el.closest(".xterm");
}

export function isTerminalXtermFocused(): boolean {
  return isUserTerminalXtermFocused() || isSessionTerminalXtermFocused();
}

export function terminalExitTaskStatus(exitCode?: number): TaskStatus {
  return exitCode === 0 ? "finished" : "terminated";
}

/** Cmd/Ctrl + =/+ zoom in, Cmd/Ctrl + - zoom out; null when not a zoom chord. */
export function terminalZoomStepFromKeyboard(e: KeyboardEvent): 1 | -1 | null {
  if (e.type !== "keydown") return null;
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "Equal") return 1;
  if (e.key === "-" || e.code === "Minus") return -1;
  return null;
}

/**
 * Wire native drag-and-drop on `host` so dropped files or pinned-project
 * paths paste into the active PTY (matches iTerm / Terminal.app behavior;
 * Claude Code reads images by path). Returns a cleanup function.
 */
export function wireTerminalFileDrop(opts: {
  host: HTMLElement;
  electron: Electron;
  getActivePtyId: () => string | null;
  onFocus: () => void;
}): () => void {
  const { host, electron, getActivePtyId, onFocus } = opts;
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files") || isProjectPathDrag(e)) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const activePtyId = getActivePtyId();
    if (!activePtyId) return;

    const projectPath = readProjectPathFromDragEvent(e);
    if (projectPath) {
      electron.pty.write(activePtyId, formatPathForTerminalPaste(projectPath) + " ");
      onFocus();
      return;
    }

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    void (async () => {
      const resolved: string[] = [];
      for (const file of files.slice(0, TERMINAL_DROP_MAX_FILES)) {
        const path = await resolveTerminalDropPath(electron, file);
        if (path) resolved.push(path);
      }
      const paths = resolved.map((p) => formatPathForTerminalPaste(p));
      if (!paths.length) return;
      electron.pty.write(activePtyId, paths.join(" ") + " ");
      onFocus();
    })();
  };
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);
  return () => {
    host.removeEventListener("dragover", onDragOver);
    host.removeEventListener("drop", onDrop);
  };
}

function isTerminalImageFile(file: File): boolean {
  return TERMINAL_IMAGE_MIME.test(file.type) || TERMINAL_IMAGE_EXT.test(file.name);
}

async function resolveTerminalDropPath(electron: Electron, file: File): Promise<string | null> {
  const nativePath = electron.getPathForFile(file);
  if (nativePath) return nativePath;
  if (!isTerminalImageFile(file)) return null;
  if (file.size > TERMINAL_IMAGE_MAX_BYTES) return null;
  const result = await electron.terminalImages.saveDropped({
    name: file.name,
    mimeType: file.type,
    data: await file.arrayBuffer(),
  });
  return "path" in result ? result.path : null;
}

/**
 * Override xterm.js key handling so Shift+Enter, Cmd-key passthroughs, etc.
 * write the right escape sequence to the PTY instead of falling back to
 * xterm's plain-CR for every Enter. Mirrors the iTerm2 / Terminal.app key
 * map that `claude /terminal-setup` registers.
 *
 * preventDefault matters: returning false makes xterm bail before its own
 * preventDefault, so without this the hidden textarea also inserts `\n` and
 * xterm's input handler writes it to the PTY.
 */
export function attachTerminalKeyHandler(opts: {
  term: TerminalLike;
  electron: Electron;
  getActivePtyId: () => string | null;
}): void {
  const { term, electron, getActivePtyId } = opts;
  term.attachCustomKeyEventHandler((e) => {
    // Copy/paste chords. Windows/Linux need the common Ctrl+C-with-selection and
    // Ctrl+V path; Ctrl+C without a selection still passes through as SIGINT.
    // Use the Electron bridge because web clipboard permissions are intentionally
    // denied in the app shell. Pasting goes through term.paste(), so xterm keeps
    // bracketed-paste semantics and emits the final bytes through onData.
    const clipboardAction = terminalClipboardAction(e, { hasSelection: term.hasSelection() });
    if (clipboardAction) {
      e.preventDefault();
      if (e.type === "keydown") {
        if (clipboardAction === "copy") {
          if (term.hasSelection()) {
            const selection = stripTerminalSelectionFormatting(term.getSelection());
            if (selection) {
              void electron.clipboard
                .writeText(selection)
                .then(() => {
                  term.clearSelection();
                })
                .catch(() => undefined);
            }
          }
        } else {
          void electron.clipboard
            .readText()
            .then(async (text) => {
              if (text) {
                term.paste(text);
                return;
              }
              const image = await electron.terminalImages.saveClipboard();
              if (image && "path" in image) {
                term.paste(formatPathForTerminalPaste(image.path) + " ");
              }
            })
            .catch(() => undefined);
        }
      }
      return false;
    }

    const bytes = mapTerminalKey(e);
    if (bytes === null) {
      if (!shouldSuppressTerminalKey(e)) return true;
      e.preventDefault();
      return false;
    }
    e.preventDefault();
    const activePtyId = getActivePtyId();
    if (activePtyId) electron.pty.write(activePtyId, bytes);
    return false;
  });
}
