/**
 * Distinguish real user keystrokes from everything else riding `term.onData`.
 *
 * Claude Code enables focus reporting, mouse tracking (click/wheel/motion),
 * and issues status queries (device attributes, cursor position, mode and
 * window-size reports, color queries) — xterm answers all of them on the same
 * stream keystrokes use. Enumerating every reply proved brittle (focus, then
 * mouse, then resize reports each slipped through), so the classification is
 * inverted: strip every complete ANSI sequence and count only KNOWN key
 * encodings — or leftover literal characters — as typing. Unknown escape
 * sequences default to "terminal-generated".
 */

// CSI = ESC [ params(0x30–0x3F) intermediates(0x20–0x2F) final(0x40–0x7E).
const CSI = "\\x1b\\[[0-9:;<=>?]*[ -/]*[@-~]";

const ANSI_SEQ_RE = new RegExp(
  [
    "\\x1b\\[M[\\s\\S]{3}", // legacy X10 mouse report (before generic CSI)
    CSI,
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)", // OSC (color replies etc.)
    "\\x1bP[\\s\\S]*?\\x1b\\\\", // DCS (XTGETTCAP replies etc.)
    "\\x1bO[\\s\\S]", // SS3 (application cursor keys, F1–F4)
  ].join("|"),
  "g",
);

// Sequences a keyboard actually produces: CSI/SS3 cursor keys (with optional
// modifiers), shift-tab, tilde-encoded keys (Del, PgUp/PgDn, bracketed-paste
// markers), and kitty CSI-u keys. Terminal reports never use these finals.
const USER_KEY_RE =
  /^(?:\x1b\[[0-9;]*[A-DHFZ]|\x1bO[A-DHFPQRS]|\x1b\[[0-9;]+~|\x1b\[[0-9;]+u)$/;

/** True when `data` contains no actual user keystrokes. */
export function isTerminalAutoReply(data: string): boolean {
  if (!data) return true;
  let sawUserKey = false;
  const rest = data.replace(ANSI_SEQ_RE, (seq) => {
    if (USER_KEY_RE.test(seq)) sawUserKey = true;
    return "";
  });
  // Leftover literals (printables, Enter, Space, Tab, Backspace, bare Esc)
  // are typing; a fully consumed string of non-key sequences is not.
  return !sawUserKey && rest.length === 0;
}
