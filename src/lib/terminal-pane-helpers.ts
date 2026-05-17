import { getElectron } from "./electron";
import { mapTerminalKey, shouldSuppressTerminalKey } from "./terminal-keymap";

type Electron = NonNullable<ReturnType<typeof getElectron>>;

type TerminalLike = {
  focus(): void;
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void;
};

const PATH_NEEDS_QUOTING = /[\s"'\\]/;
const QUOTE_ESCAPE = /"/g;

/**
 * Wire native drag-and-drop on `host` so dropped files paste their absolute
 * paths into the active PTY (matches iTerm / Terminal.app behavior; Claude
 * Code reads images by path). Returns a cleanup function.
 */
export function wireTerminalFileDrop(opts: {
  host: HTMLElement;
  electron: Electron;
  getActivePtyId: () => string | null;
  onFocus: () => void;
}): () => void {
  const { host, electron, getActivePtyId, onFocus } = opts;
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    const activePtyId = getActivePtyId();
    if (!activePtyId) return;
    const paths = files
      .map((f) => electron.getPathForFile(f))
      .filter(Boolean)
      .map((p) => (PATH_NEEDS_QUOTING.test(p) ? `"${p.replace(QUOTE_ESCAPE, '\\"')}"` : p));
    if (!paths.length) return;
    electron.pty.write(activePtyId, paths.join(" ") + " ");
    onFocus();
  };
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);
  return () => {
    host.removeEventListener("dragover", onDragOver);
    host.removeEventListener("drop", onDrop);
  };
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
