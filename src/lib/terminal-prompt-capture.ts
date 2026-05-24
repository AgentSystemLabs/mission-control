const BACKSPACE = "\x7f";
const CTRL_H = "\b";

function stripTerminalEscapes(chunk: string): string {
  return chunk
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\x1b./g, "");
}

/**
 * Accumulate printable terminal input until the user submits with Enter.
 * Used when an agent CLI does not fire beforeSubmitPrompt / UserPromptSubmit hooks.
 */
export function accumulateTerminalPrompt(
  buffer: string,
  chunk: string,
): { buffer: string; submitted: string | null } {
  let next = buffer;
  for (const char of stripTerminalEscapes(chunk)) {
    if (char === "\r" || char === "\n") {
      const submitted = next.trim();
      return { buffer: "", submitted: submitted || null };
    }
    if (char === BACKSPACE || char === CTRL_H) {
      next = next.slice(0, -1);
      continue;
    }
    if (char >= " " || char === "\t") {
      next += char;
    }
  }
  return { buffer: next, submitted: null };
}
