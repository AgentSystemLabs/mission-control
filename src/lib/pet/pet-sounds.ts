import { DEFAULT_PET_SPECIES, type PetSpeciesId } from "~/shared/pet";

/**
 * Mission Pet voice — tiny synthesized chirps played on petting when pet
 * sounds are enabled. WebAudio-generated (no assets to ship): each species is
 * a short sequence of pitch-swept notes through a soft attack/decay envelope,
 * so every species has a recognizable "voice" at whisper volume.
 */

type ChirpNote = {
  /** Start/end frequency of the sweep, Hz. */
  from: number;
  to: number;
  /** Note length in seconds. */
  dur: number;
  /** Offset from the chirp start in seconds. */
  at: number;
  type: OscillatorType;
  /** Peak gain — keep these whisper-soft (≤ 0.09). */
  gain: number;
};

const SPECIES_CHIRPS: Record<PetSpeciesId, ChirpNote[]> = {
  // Mochi the blob: one round boop.
  mochi: [{ from: 520, to: 680, dur: 0.14, at: 0, type: "sine", gain: 0.07 }],
  // Bunny: a quick double squeak.
  bunny: [
    { from: 900, to: 1250, dur: 0.07, at: 0, type: "sine", gain: 0.05 },
    { from: 950, to: 1350, dur: 0.08, at: 0.09, type: "sine", gain: 0.05 },
  ],
  // Chick: one bright cheep.
  chick: [{ from: 1250, to: 1600, dur: 0.09, at: 0, type: "triangle", gain: 0.05 }],
  // Cub: a low friendly wuf.
  cub: [{ from: 320, to: 210, dur: 0.12, at: 0, type: "triangle", gain: 0.09 }],
  // Lotl: a watery two-step bloop.
  lotl: [
    { from: 460, to: 340, dur: 0.1, at: 0, type: "sine", gain: 0.07 },
    { from: 380, to: 500, dur: 0.09, at: 0.11, type: "sine", gain: 0.06 },
  ],
  // Rivet the robot: square-wave beep-boop.
  rivet: [
    { from: 660, to: 660, dur: 0.07, at: 0, type: "square", gain: 0.03 },
    { from: 440, to: 440, dur: 0.09, at: 0.1, type: "square", gain: 0.03 },
  ],
  // Trundle: a slow low mechanical purr.
  trundle: [{ from: 250, to: 190, dur: 0.18, at: 0, type: "triangle", gain: 0.08 }],
  // Ember the flame spirit: a warm crackle — two quick rising flickers.
  ember: [
    { from: 640, to: 1040, dur: 0.07, at: 0, type: "triangle", gain: 0.05 },
    { from: 480, to: 860, dur: 0.09, at: 0.09, type: "triangle", gain: 0.05 },
  ],
};

/** The spam-click reaction: a wobbly slide down, the same for every species. */
const DIZZY_NOTES: ChirpNote[] = [
  { from: 740, to: 220, dur: 0.3, at: 0, type: "triangle", gain: 0.06 },
];

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return null;
  ctx ??= new AudioContext();
  // Petting is a user gesture, so a suspended context may resume here.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Play a species' petting chirp (or the dizzy warble). No-ops without WebAudio. */
export function playPetChirp(species: PetSpeciesId, kind: "pet" | "dizzy" = "pet"): void {
  const audio = getContext();
  if (!audio) return;
  const notes =
    kind === "dizzy" ? DIZZY_NOTES : (SPECIES_CHIRPS[species] ?? SPECIES_CHIRPS[DEFAULT_PET_SPECIES]);
  const t0 = audio.currentTime + 0.01;
  for (const note of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = t0 + note.at;
    const end = start + note.dur;
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, note.to), end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(note.gain, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}
