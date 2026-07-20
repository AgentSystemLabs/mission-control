// Scratch pads — per-project temporary text buffers opened from the top bar.
// Framework-free types + guards shared by server and renderer.

/** Hard cap on pad content; a scratch pad is a paste buffer, not a document store. */
export const SCRATCH_PAD_CONTENT_MAX = 100_000;

/** Max characters of the derived display title shown in the dropdown. */
export const SCRATCH_PAD_TITLE_MAX = 60;

export interface ScratchPadView {
  id: string;
  projectId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScratchPadCreateInput {
  projectId: string;
  content?: string;
}

export interface ScratchPadUpdateInput {
  content: string;
}

/** Display title for a pad: first non-empty line of content, truncated. */
export function scratchPadTitle(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "Empty scratch pad";
  return line.length > SCRATCH_PAD_TITLE_MAX ? `${line.slice(0, SCRATCH_PAD_TITLE_MAX - 1)}…` : line;
}
