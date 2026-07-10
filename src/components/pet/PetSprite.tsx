import { memo } from "react";
import type { PetMood } from "~/lib/pet/pet-store";

/**
 * Mission Pet sprite — "Mochi": a pear-soft line-drawn companion with a
 * heart-tipped antenna, big shine eyes, blush cheeks, and stub arms that go
 * up when celebrating. Themed entirely via CSS variables (accent stroke,
 * surface fill) so it adapts to every theme. Expression comes from static
 * per-mood eyes/mouth, which is also the reduced-motion story: with
 * animations off, mood still reads at a glance. All motion lives in CSS keyed
 * off `data-mood` (see the Mission Pet section in styles.css).
 */

export type PetSpriteProps = {
  mood: PetMood;
  intensity: 1 | 2 | 3;
  night: boolean;
  level: number;
};

const INTENSITY_SPEED: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.5, 3: 2.2 };

const EYE_LEFT = 38;
const EYE_RIGHT = 62;
const EYE_Y = 55;
const MOUTH_Y = 67;

type EyeKind = "open" | "wide" | "closed" | "happy";

function eyeKindFor(mood: PetMood): EyeKind {
  if (mood === "sleeping") return "closed";
  if (mood === "celebrating") return "happy";
  if (mood === "alert" || mood === "startled") return "wide";
  return "open";
}

function Eyes({ kind }: { kind: EyeKind }) {
  if (kind === "closed") {
    return (
      <g className="mc-pet-eyes" data-eyes="closed">
        <path d={`M ${EYE_LEFT - 5} ${EYE_Y} Q ${EYE_LEFT} ${EYE_Y + 4} ${EYE_LEFT + 5} ${EYE_Y}`} />
        <path d={`M ${EYE_RIGHT - 5} ${EYE_Y} Q ${EYE_RIGHT} ${EYE_Y + 4} ${EYE_RIGHT + 5} ${EYE_Y}`} />
      </g>
    );
  }
  if (kind === "happy") {
    return (
      <g className="mc-pet-eyes" data-eyes="happy">
        <path d={`M ${EYE_LEFT - 5} ${EYE_Y + 1} Q ${EYE_LEFT} ${EYE_Y - 5} ${EYE_LEFT + 5} ${EYE_Y + 1}`} />
        <path d={`M ${EYE_RIGHT - 5} ${EYE_Y + 1} Q ${EYE_RIGHT} ${EYE_Y - 5} ${EYE_RIGHT + 5} ${EYE_Y + 1}`} />
      </g>
    );
  }
  const r = kind === "wide" ? 6.6 : 5.8;
  const eye = (cx: number) => (
    <g className="mc-pet-eye" key={cx}>
      <circle className="mc-pet-pupil" cx={cx} cy={EYE_Y} r={r} />
      <circle className="mc-pet-shine" cx={cx - 2} cy={EYE_Y - 2} r={1.9} />
      <circle className="mc-pet-shine" cx={cx + 1.6} cy={EYE_Y + 1.6} r={0.9} opacity={0.85} />
    </g>
  );
  return (
    <g className="mc-pet-eyes" data-eyes={kind}>
      {eye(EYE_LEFT)}
      {eye(EYE_RIGHT)}
    </g>
  );
}

function Mouth({ mood }: { mood: PetMood }) {
  switch (mood) {
    case "sleeping":
      return <path className="mc-pet-mouth" d={`M 47 ${MOUTH_Y} Q 50 ${MOUTH_Y + 2} 53 ${MOUTH_Y}`} />;
    case "celebrating":
      return <path className="mc-pet-mouth" d={`M 43 ${MOUTH_Y - 2} Q 50 ${MOUTH_Y + 7} 57 ${MOUTH_Y - 2}`} />;
    case "alert":
      return <ellipse className="mc-pet-mouth-o" cx={50} cy={MOUTH_Y + 1} rx={3} ry={3.6} />;
    case "startled":
      return (
        <path
          className="mc-pet-mouth"
          d={`M 43 ${MOUTH_Y + 1} Q 46 ${MOUTH_Y - 2} 49 ${MOUTH_Y + 1} Q 52 ${MOUTH_Y + 4} 55 ${MOUTH_Y + 1}`}
        />
      );
    case "working":
    case "shipping":
      return <path className="mc-pet-mouth" d={`M 45 ${MOUTH_Y} Q 50 ${MOUTH_Y + 2} 55 ${MOUTH_Y}`} />;
    default:
      // The little ω — Mochi's resting face.
      return (
        <path
          className="mc-pet-mouth"
          d={`M 44 ${MOUTH_Y} Q 47 ${MOUTH_Y + 3} 50 ${MOUTH_Y} Q 53 ${MOUTH_Y + 3} 56 ${MOUTH_Y}`}
        />
      );
  }
}

export const PetSprite = memo(function PetSprite({ mood, intensity, night, level }: PetSpriteProps) {
  const sparkle = level >= 3;
  const armsUp = mood === "celebrating";
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
      {/* Antenna with heart tip */}
      <g className="mc-pet-antenna">
        <line x1="50" y1="26" x2="50" y2="16" />
        <path
          className="mc-pet-antenna-tip"
          d="M 50 13 C 48 8.5 42.5 9.8 43.8 13.8 C 44.5 16 47.5 18 50 19.8 C 52.5 18 55.5 16 56.2 13.8 C 57.5 9.8 52 8.5 50 13 Z"
        />
        {sparkle ? (
          <g
            className="mc-pet-sparkle"
            style={{ "--pet-sparkle": Math.min(1, 0.4 + level * 0.06) } as React.CSSProperties}
          >
            <path d="M 62 6 L 64 2 L 66 6 L 70 8 L 66 10 L 64 14 L 62 10 L 58 8 Z" />
          </g>
        ) : null}
      </g>

      {/* Pear-soft body */}
      <path
        className="mc-pet-body"
        d="M 50 90 C 25 90 13 77 15 59 C 18 38 34 26 50 26 C 66 26 82 38 85 59 C 87 77 75 90 50 90 Z"
      />

      {/* Stub arms — thrown up when celebrating */}
      <g className="mc-pet-arms">
        {armsUp ? (
          <>
            <path d="M 18 56 Q 8 48 10 42" />
            <path d="M 82 56 Q 92 48 90 42" />
          </>
        ) : (
          <>
            <path d="M 17 62 Q 9 66 12 72" />
            <path d="M 83 62 Q 91 66 88 72" />
          </>
        )}
      </g>

      {/* Tiny feet */}
      <g className="mc-pet-feet">
        <path d="M 38 90 Q 38 86 42 86" />
        <path d="M 62 90 Q 62 86 58 86" />
      </g>

      {/* Face */}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} />
        <Mouth mood={mood} />
        <ellipse className="mc-pet-blush" cx={28} cy={64} rx={4.6} ry={2.4} />
        <ellipse className="mc-pet-blush" cx={72} cy={64} rx={4.6} ry={2.4} />
      </g>

      {/* Mood props */}
      {mood === "sleeping" ? (
        <g className="mc-pet-zzz">
          <text x="74" y="24" className="mc-pet-zzz-glyph">
            z
          </text>
          <text x="83" y="14" className="mc-pet-zzz-glyph mc-pet-zzz-glyph-2">
            z
          </text>
        </g>
      ) : null}
      {mood === "shipping" ? (
        <g className="mc-pet-crate">
          <rect x="72" y="72" width="16" height="14" rx="2" />
          <line x1="72" y1="79" x2="88" y2="79" />
          <line x1="80" y1="72" x2="80" y2="86" />
        </g>
      ) : null}
      {mood === "celebrating" ? (
        <g className="mc-pet-confetti">
          <line x1="16" y1="16" x2="20" y2="12" />
          <line x1="82" y1="18" x2="86" y2="14" />
          <line x1="10" y1="40" x2="15" y2="39" />
          <line x1="88" y1="38" x2="93" y2="36" />
        </g>
      ) : null}
      {mood === "working" && intensity >= 3 ? (
        <path className="mc-pet-sweat" d="M 80 34 Q 83 39 80 42 Q 77 39 80 34 Z" />
      ) : null}
      {mood === "alert" ? (
        <g className="mc-pet-alert-mark">
          <line x1="90" y1="14" x2="90" y2="26" />
          <circle cx="90" cy="33" r="1.9" />
        </g>
      ) : null}
    </svg>
  );
});

export type PetSpecies = {
  id: string;
  Sprite: typeof PetSprite;
};

/** Species seam — v1 ships Mochi; future species register here. */
export const PET_SPECIES: Record<string, PetSpecies> = {
  mochi: { id: "mochi", Sprite: PetSprite },
};
