import { memo } from "react";
import type { PetMood } from "~/lib/pet/pet-store";

/**
 * Mission Pet sprite — a hand-authored line-drawn blob, themed entirely via
 * CSS variables (accent stroke, surface fill) so it adapts to every theme.
 * Expression comes from static per-mood eye/brow/mouth paths, which is also
 * the reduced-motion story: with animations off, mood still reads at a glance.
 * All motion lives in CSS keyed off `data-mood` (see the Mission Pet section
 * in styles.css).
 */

export type PetSpriteProps = {
  mood: PetMood;
  intensity: 1 | 2 | 3;
  night: boolean;
  level: number;
};

type Face = {
  eyes: "open" | "closed" | "happy" | "wide";
  /** Brow paths; omitted = relaxed (none drawn). */
  leftBrow?: string;
  rightBrow?: string;
  mouth: string;
};

const FACES: Record<PetMood, Face> = {
  idle: {
    eyes: "open",
    mouth: "M 44 63 Q 50 67 56 63",
  },
  sleeping: {
    eyes: "closed",
    mouth: "M 47 64 Q 50 66 53 64",
  },
  watching: {
    eyes: "open",
    leftBrow: "M 33 38 Q 38 35 43 38",
    rightBrow: "M 57 38 Q 62 35 67 38",
    mouth: "M 45 63 Q 50 66 55 63",
  },
  working: {
    eyes: "open",
    leftBrow: "M 33 39 L 43 41",
    rightBrow: "M 67 39 L 57 41",
    mouth: "M 45 64 L 55 64",
  },
  alert: {
    eyes: "wide",
    leftBrow: "M 33 36 Q 38 32 43 36",
    rightBrow: "M 57 36 Q 62 32 67 36",
    mouth: "M 47 61 A 3.2 3.6 0 1 0 53 61 A 3.2 3.6 0 1 0 47 61",
  },
  celebrating: {
    eyes: "happy",
    mouth: "M 42 61 Q 50 70 58 61",
  },
  shipping: {
    eyes: "open",
    leftBrow: "M 33 39 L 43 41",
    rightBrow: "M 67 39 L 57 41",
    mouth: "M 45 63 Q 50 65 55 63",
  },
  startled: {
    eyes: "wide",
    leftBrow: "M 33 35 Q 38 33 43 36",
    rightBrow: "M 57 36 Q 62 33 67 35",
    mouth: "M 43 64 Q 46 61 49 64 Q 52 67 55 64",
  },
};

const INTENSITY_SPEED: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.5, 3: 2.2 };

function Eyes({ kind }: { kind: Face["eyes"] }) {
  if (kind === "closed") {
    return (
      <g className="mc-pet-eyes" data-eyes="closed">
        <path d="M 33 48 Q 38 52 43 48" />
        <path d="M 57 48 Q 62 52 67 48" />
      </g>
    );
  }
  if (kind === "happy") {
    return (
      <g className="mc-pet-eyes" data-eyes="happy">
        <path d="M 33 49 Q 38 43 43 49" />
        <path d="M 57 49 Q 62 43 67 49" />
      </g>
    );
  }
  const r = kind === "wide" ? 5.6 : 4.2;
  return (
    <g className="mc-pet-eyes" data-eyes={kind}>
      <circle className="mc-pet-pupil" cx="38" cy="48" r={r} />
      <circle className="mc-pet-pupil" cx="62" cy="48" r={r} />
    </g>
  );
}

export const PetSprite = memo(function PetSprite({ mood, intensity, night, level }: PetSpriteProps) {
  const face = FACES[mood];
  const sparkle = level >= 3;
  return (
    <svg
      className="mc-pet"
      data-mood={mood}
      data-night={night || undefined}
      viewBox="0 0 100 100"
      width="84"
      height="84"
      aria-hidden
      style={{ "--pet-speed": INTENSITY_SPEED[intensity] } as React.CSSProperties}
    >
      <g className="mc-pet-body-group">
        {/* Antenna */}
        <g className="mc-pet-antenna">
          <line x1="50" y1="16" x2="50" y2="6" />
          <circle className="mc-pet-antenna-tip" cx="50" cy="5" r="3" />
          {sparkle ? (
            <g className="mc-pet-sparkle" style={{ "--pet-sparkle": Math.min(1, 0.4 + level * 0.06) } as React.CSSProperties}>
              <path d="M 58 6 L 60 2 L 62 6 L 66 8 L 62 10 L 60 14 L 58 10 L 54 8 Z" />
            </g>
          ) : null}
        </g>

        {/* Body blob */}
        <path
          className="mc-pet-body"
          d="M 50 90 C 24 90 13 70 15 50 C 17 30 32 15 50 15 C 68 15 83 30 85 50 C 87 70 76 90 50 90 Z"
        />

        {/* Tiny feet */}
        <g className="mc-pet-feet">
          <path d="M 36 89 Q 36 94 32 94" />
          <path d="M 64 89 Q 64 94 68 94" />
        </g>

        {/* Face */}
        <g className="mc-pet-face">
          {face.leftBrow ? <path className="mc-pet-brow" d={face.leftBrow} /> : null}
          {face.rightBrow ? <path className="mc-pet-brow" d={face.rightBrow} /> : null}
          <Eyes kind={face.eyes} />
          <path className="mc-pet-mouth" d={face.mouth} />
        </g>

        {/* Mood props */}
        {mood === "sleeping" ? (
          <g className="mc-pet-zzz">
            <text x="72" y="26" className="mc-pet-zzz-glyph">
              z
            </text>
            <text x="80" y="16" className="mc-pet-zzz-glyph mc-pet-zzz-glyph-2">
              z
            </text>
          </g>
        ) : null}
        {mood === "shipping" ? (
          <g className="mc-pet-crate">
            <rect x="70" y="70" width="16" height="14" rx="2" />
            <line x1="70" y1="77" x2="86" y2="77" />
            <line x1="78" y1="70" x2="78" y2="84" />
          </g>
        ) : null}
        {mood === "celebrating" ? (
          <g className="mc-pet-confetti">
            <line x1="18" y1="18" x2="22" y2="14" />
            <line x1="80" y1="20" x2="84" y2="16" />
            <line x1="12" y1="42" x2="17" y2="41" />
            <line x1="86" y1="40" x2="91" y2="38" />
          </g>
        ) : null}
        {mood === "working" && intensity >= 3 ? (
          <path className="mc-pet-sweat" d="M 78 30 Q 81 35 78 38 Q 75 35 78 30 Z" />
        ) : null}
        {mood === "alert" ? (
          <g className="mc-pet-alert-mark">
            <line x1="88" y1="18" x2="88" y2="28" />
            <circle cx="88" cy="34" r="1.8" />
          </g>
        ) : null}
      </g>
    </svg>
  );
});

export type PetSpecies = {
  id: string;
  Sprite: typeof PetSprite;
};

/** Species seam — v1 ships the blob; future species register here. */
export const PET_SPECIES: Record<string, PetSpecies> = {
  blob: { id: "blob", Sprite: PetSprite },
};
