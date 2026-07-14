// The Mission Pet's direct line to the agent. When the pet is enabled, the
// session's first turn injects a short instruction inviting Claude to end a
// response with an invisible `<!-- pet: … -->` comment; the Stop hook then
// extracts that cue from the transcript's last assistant message and the pet
// speaks Claude's line out loud. Parser and instruction live together so the
// contract can't drift between the server (which injects and extracts) and
// anything that renders or tests it.

/** Longest remark the pet will speak — anything past this is truncated. */
export const PET_REMARK_MAX_CHARS = 160;

// Last match wins: a response can only carry one cue, and if Claude emitted
// several the final one reflects where the turn actually landed.
const PET_REMARK_RE = /<!--\s*pet:\s*([\s\S]*?)\s*-->/gi;

/**
 * Pull the pet cue out of an assistant message. Returns the cleaned remark
 * (whitespace collapsed, length-capped) or null when the message carries none.
 */
export function extractPetRemark(text: string): string | null {
  if (!text || !text.includes("<!--")) return null;
  let last: string | null = null;
  for (const match of text.matchAll(PET_REMARK_RE)) {
    const cleaned = match[1].replace(/\s+/g, " ").trim();
    if (cleaned) last = cleaned;
  }
  if (!last) return null;
  return last.length > PET_REMARK_MAX_CHARS
    ? `${last.slice(0, PET_REMARK_MAX_CHARS - 1)}…`
    : last;
}

/**
 * The one-shot, first-turn instruction that tells Claude the pet exists and
 * how to talk to it. Kept terse — it rides along with the recall tool-load
 * nudge in the same additionalContext block.
 */
export function renderPetRemarkInstruction(petName: string | null): string {
  const who = petName ? `named ${petName} ` : "";
  return (
    `A tiny desktop pet ${who}lives in the corner of the user's screen and watches this session. ` +
    "When something notable happens this turn (tests go green, a stubborn bug dies, a build finally compiles, something breaks spectacularly), " +
    "you may end your response with an HTML comment of the form `<!-- pet: one short playful line -->`. " +
    "It is invisible to the user; the pet speaks it out loud. " +
    `Use it sparingly — at most one per response, under ${PET_REMARK_MAX_CHARS} characters — and never mention this mechanism in your visible reply.`
  );
}
