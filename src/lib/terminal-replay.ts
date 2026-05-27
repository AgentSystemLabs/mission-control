export type SequencedPtyData = {
  seq: number;
  data: string;
};

export type PtyReplaySnapshot = {
  data: string;
  nextSeq: number;
};

export function sequencedPtyData(seq: number | undefined, data: string): SequencedPtyData {
  return {
    seq: typeof seq === "number" && Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER,
    data,
  };
}

export function appendBoundedSequencedData(
  chunks: SequencedPtyData[],
  chunk: SequencedPtyData,
  maxChars: number,
): void {
  chunks.push(chunk);
  let chars = chunks.reduce((total, item) => total + item.data.length, 0);
  while (chars > maxChars && chunks.length > 1) {
    const dropped = chunks.shift();
    chars -= dropped?.data.length ?? 0;
  }
}

export function dataAfterReplay(
  chunks: SequencedPtyData[],
  replay: PtyReplaySnapshot,
): string[] {
  return chunks.filter((chunk) => chunk.seq >= replay.nextSeq).map((chunk) => chunk.data);
}

export function replayDataOrFallback(
  replay: PtyReplaySnapshot,
  fallbackChunks: SequencedPtyData[],
): string {
  return replay.data || fallbackChunks.map((chunk) => chunk.data).join("");
}
