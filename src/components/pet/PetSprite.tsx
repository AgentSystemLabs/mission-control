import { memo, type ReactNode } from "react";
import type { PetSpeciesId } from "~/shared/pet";
import type { PetMood } from "~/lib/pet/pet-store";

/**
 * Mission Pet sprites — seven hand-drawn line-art species sharing one face
 * grammar (shine eyes, blush, mood mouths) and one prop set (Zzz, crate,
 * confetti, sweat, alert mark). Themed entirely via CSS variables (accent
 * stroke, surface fill) so every species adapts to every theme. Expression is
 * static per-mood markup, which is also the reduced-motion story; all motion
 * lives in CSS keyed off `data-mood` (see the Mission Pet section in
 * styles.css).
 */

export type PetSpriteProps = {
  mood: PetMood;
  intensity: 1 | 2 | 3;
  night: boolean;
  level: number;
  /** Molt count — any value above 0 pins the permanent star badge. */
  prestige?: number;
  /**
   * Which of the mood's animation variants plays (0..9, see the per-mood
   * data-move rules in styles.css). Omitted (settings picker) = variant 0.
   */
  move?: number;
  /** Rendered square size in px (the settings picker uses a small one). */
  size?: number;
};

const INTENSITY_SPEED: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.5, 3: 2.2 };

/* ── shared face grammar ─────────────────────────────────────────────── */

type EyeKind = "open" | "wide" | "closed" | "happy";

function eyeKindFor(mood: PetMood): EyeKind {
  if (mood === "sleeping") return "closed";
  if (mood === "celebrating" || mood === "singing") return "happy";
  if (mood === "alert" || mood === "startled") return "wide";
  return "open";
}

function Eyes({ kind, y, lx = 38, rx = 62 }: { kind: EyeKind; y: number; lx?: number; rx?: number }) {
  if (kind === "closed") {
    return (
      <g className="mc-pet-eyes" data-eyes="closed">
        <path d={`M ${lx - 5} ${y} Q ${lx} ${y + 4} ${lx + 5} ${y}`} />
        <path d={`M ${rx - 5} ${y} Q ${rx} ${y + 4} ${rx + 5} ${y}`} />
      </g>
    );
  }
  if (kind === "happy") {
    return (
      <g className="mc-pet-eyes" data-eyes="happy">
        <path d={`M ${lx - 5} ${y + 1} Q ${lx} ${y - 5} ${lx + 5} ${y + 1}`} />
        <path d={`M ${rx - 5} ${y + 1} Q ${rx} ${y - 5} ${rx + 5} ${y + 1}`} />
      </g>
    );
  }
  const r = kind === "wide" ? 6.6 : 5.8;
  // Pupil + shines share a group so moods can dart the gaze around inside the
  // eye while the blink squish stays on the outer .mc-pet-eye wrapper.
  const eye = (cx: number) => (
    <g className="mc-pet-eye" key={cx}>
      <g className="mc-pet-pupil-set">
        <circle className="mc-pet-pupil" cx={cx} cy={y} r={r} />
        <circle className="mc-pet-shine" cx={cx - 2} cy={y - 2} r={1.9} />
        <circle className="mc-pet-shine" cx={cx + 1.6} cy={y + 1.6} r={0.9} opacity={0.85} />
      </g>
    </g>
  );
  return (
    <g className="mc-pet-eyes" data-eyes={kind}>
      {eye(lx)}
      {eye(rx)}
    </g>
  );
}

function Mouth({ mood, y }: { mood: PetMood; y: number }) {
  switch (mood) {
    case "sleeping":
      return <path className="mc-pet-mouth" d={`M 47 ${y} Q 50 ${y + 2} 53 ${y}`} />;
    case "celebrating":
      return <path className="mc-pet-mouth" d={`M 43 ${y - 2} Q 50 ${y + 7} 57 ${y - 2}`} />;
    case "alert":
      return <ellipse className="mc-pet-mouth-o" cx={50} cy={y + 1} rx={3} ry={3.6} />;
    case "singing":
      // Mouth open mid-note — a taller oval than the alert "o".
      return <ellipse className="mc-pet-mouth-o mc-pet-mouth-sing" cx={50} cy={y + 1} rx={3.2} ry={4.6} />;
    case "startled":
      return (
        <path
          className="mc-pet-mouth"
          d={`M 43 ${y + 1} Q 46 ${y - 2} 49 ${y + 1} Q 52 ${y + 4} 55 ${y + 1}`}
        />
      );
    case "working":
    case "shipping":
      return <path className="mc-pet-mouth" d={`M 45 ${y} Q 50 ${y + 2} 55 ${y}`} />;
    default:
      // The little ω resting face.
      return (
        <path
          className="mc-pet-mouth"
          d={`M 44 ${y} Q 47 ${y + 3} 50 ${y} Q 53 ${y + 3} 56 ${y}`}
        />
      );
  }
}

function Blush({ y, lx = 28, rx = 72 }: { y: number; lx?: number; rx?: number }) {
  return (
    <>
      <ellipse className="mc-pet-blush" cx={lx} cy={y} rx={4.6} ry={2.4} />
      <ellipse className="mc-pet-blush" cx={rx} cy={y} rx={4.6} ry={2.4} />
    </>
  );
}

function MoodProps({ mood, intensity }: { mood: PetMood; intensity: 1 | 2 | 3 }) {
  return (
    <>
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
      {mood === "singing" ? (
        <>
          {/* A little acoustic guitar cradled across the belly. Drawn in its own
              local frame (body center at origin, neck along -x) then placed with
              the outer translate/rotate; the inner group is what CSS strums, so
              the rock animation never fights the placement transform. Drawn last
              so it sits over body and arms. */}
          {/* While singing the stub arms hide (CSS) and these reach-arms take
              over — drawn under the guitar so the wrists tuck behind it and
              the paws on the neck and strings read as the hands. */}
          <g className="mc-pet-sing-arms">
            <path d="M 20 63 Q 28 68 38 61" />
            <path d="M 82 64 Q 77 72 69 72" />
          </g>
          <g className="mc-pet-guitar-pos" transform="translate(62 74) rotate(34)">
            <g className="mc-pet-guitar">
              <rect className="mc-pet-guitar-neck" x="-38" y="-2" width="24.5" height="4" rx="1.1" />
              <g className="mc-pet-guitar-frets">
                <line x1="-34" y1="-1.9" x2="-34" y2="1.9" />
                <line x1="-30.5" y1="-1.9" x2="-30.5" y2="1.9" />
                <line x1="-27.3" y1="-1.9" x2="-27.3" y2="1.9" />
                <line x1="-24.4" y1="-1.9" x2="-24.4" y2="1.9" />
                <line x1="-21.8" y1="-1.9" x2="-21.8" y2="1.9" />
              </g>
              <line className="mc-pet-guitar-nut" x1="-37.6" y1="-2.1" x2="-37.6" y2="2.1" />
              <rect className="mc-pet-guitar-head" x="-45" y="-3.1" width="7.4" height="6.2" rx="1.7" />
              <circle className="mc-pet-guitar-peg" cx="-43.2" cy="-4.2" r="0.95" />
              <circle className="mc-pet-guitar-peg" cx="-40.6" cy="-4.2" r="0.95" />
              <circle className="mc-pet-guitar-peg" cx="-43.2" cy="4.2" r="0.95" />
              <circle className="mc-pet-guitar-peg" cx="-40.6" cy="4.2" r="0.95" />
              <path
                className="mc-pet-guitar-body"
                d="M -13.5 0 C -13.5 -7.8 -9.2 -8.4 -5.2 -7.7 C -2.4 -7.2 -2.2 -5.9 0 -5.9 C 2.2 -5.9 2.4 -7.4 6 -8.2 C 12 -9.4 15 -5.2 15 0 C 15 5.2 12 9.4 6 8.2 C 2.4 7.4 2.2 5.9 0 5.9 C -2.2 5.9 -2.4 7.2 -5.2 7.7 C -9.2 8.4 -13.5 7.8 -13.5 0 Z"
              />
              <circle className="mc-pet-guitar-rosette" cx="-3.5" cy="0" r="4.5" />
              <circle className="mc-pet-guitar-hole" cx="-3.5" cy="0" r="3" />
              <rect className="mc-pet-guitar-bridge" x="7" y="-3.1" width="2.1" height="6.2" rx="0.9" />
              <g className="mc-pet-guitar-strings">
                <line x1="7.6" y1="-1.7" x2="-37.4" y2="-1.05" />
                <line x1="7.6" y1="0" x2="-37.4" y2="0" />
                <line x1="7.6" y1="1.7" x2="-37.4" y2="1.05" />
              </g>
              <circle className="mc-pet-guitar-paw" cx="-26" cy="0.3" r="2.7" />
              <g className="mc-pet-strum-hand">
                <circle className="mc-pet-guitar-paw" cx="2.6" cy="-4" r="2.6" />
                <path className="mc-pet-guitar-pick" d="M 1.5 -1.8 L 3.9 -1.8 L 2.7 1.2 Z" />
              </g>
            </g>
          </g>
          {/* Music notes drifting up and away; CSS floats and fades each. */}
          <g className="mc-pet-notes">
            <text x="78" y="34" className="mc-pet-note-glyph">
              ♪
            </text>
            <text x="88" y="22" className="mc-pet-note-glyph mc-pet-note-glyph-2">
              ♫
            </text>
            <text x="72" y="16" className="mc-pet-note-glyph mc-pet-note-glyph-3">
              ♪
            </text>
          </g>
        </>
      ) : null}
    </>
  );
}

/**
 * Level gear — permanent details earned at evolution thresholds (see
 * PET_EVOLUTION_LEVELS): a scarf at 5, a tool belt at 8, a tiny crown at 10.
 * One shared drawing, positioned per species like the rest of the face
 * grammar; the level-3 sparkle stays its own component (it predates these).
 */
type GearSpec = {
  scarf: { y: number; halfW: number };
  belt: { y: number; halfW: number };
  crown: { x: number; y: number; tilt?: number };
};

function LevelGear({ level, spec }: { level: number; spec: GearSpec }) {
  const { scarf, belt, crown } = spec;
  return (
    <>
      {level >= 5 ? (
        <g className="mc-pet-scarf">
          <path
            className="mc-pet-scarf-band"
            d={`M ${50 - scarf.halfW} ${scarf.y} Q 50 ${scarf.y + 7} ${50 + scarf.halfW} ${scarf.y}`}
          />
          <path
            className="mc-pet-scarf-tail"
            d={`M ${50 + scarf.halfW - 8} ${scarf.y + 4} q 3 7 -1 12`}
          />
        </g>
      ) : null}
      {level >= 8 ? (
        <g className="mc-pet-belt">
          <path
            d={`M ${50 - belt.halfW} ${belt.y} Q 50 ${belt.y + 4} ${50 + belt.halfW} ${belt.y}`}
          />
          <rect x={46.5} y={belt.y - 0.5} width={7} height={5.5} rx={1.2} />
          <circle cx={50 + belt.halfW - 6} cy={belt.y + 1.4} r={1.2} />
        </g>
      ) : null}
      {level >= 10 ? (
        <path
          className="mc-pet-crown"
          transform={crown.tilt ? `rotate(${crown.tilt} ${crown.x} ${crown.y})` : undefined}
          d={`M ${crown.x - 6} ${crown.y} L ${crown.x - 6} ${crown.y - 6} L ${crown.x - 3} ${crown.y - 2.5} L ${crown.x} ${crown.y - 7.5} L ${crown.x + 3} ${crown.y - 2.5} L ${crown.x + 6} ${crown.y - 6} L ${crown.x + 6} ${crown.y} Z`}
        />
      ) : null}
    </>
  );
}

/** The permanent molt star — worn top-left, opposite the growing sparkle. */
function PrestigeStar({ prestige }: { prestige?: number }) {
  if (!prestige) return null;
  return (
    <path
      className="mc-pet-prestige"
      d="M 14 3.5 L 16.2 8.8 L 21.5 11 L 16.2 13.2 L 14 18.5 L 11.8 13.2 L 6.5 11 L 11.8 8.8 Z"
    />
  );
}

function Sparkle({ level, dx = 0 }: { level: number; dx?: number }) {
  if (level < 3) return null;
  return (
    <g
      className="mc-pet-sparkle"
      transform={dx ? `translate(${dx} 0)` : undefined}
      style={{ "--pet-sparkle": Math.min(1, 0.4 + level * 0.06) } as React.CSSProperties}
    >
      <path d="M 62 6 L 64 2 L 66 6 L 70 8 L 66 10 L 64 14 L 62 10 L 58 8 Z" />
    </g>
  );
}

function StubArms({ up }: { up: boolean }) {
  return (
    <g className="mc-pet-arms">
      {up ? (
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
  );
}

const FEET = (
  <g className="mc-pet-feet">
    <path d="M 38 90 Q 38 86 42 86" />
    <path d="M 62 90 Q 62 86 58 86" />
  </g>
);

/** Common svg root so every species carries the same data hooks for CSS. */
function PetSvg({
  mood,
  intensity,
  night,
  move,
  prestige,
  size = 84,
  children,
}: PetSpriteProps & { children: ReactNode }) {
  return (
    <svg
      className="mc-pet"
      data-mood={mood}
      data-move={move || undefined}
      data-night={night || undefined}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      style={{ "--pet-speed": INTENSITY_SPEED[intensity] } as React.CSSProperties}
    >
      {children}
      {/* Every species wears the molt star the same way — it's the pet's, not
          the body's. */}
      <PrestigeStar prestige={prestige} />
    </svg>
  );
}

/* ── species ─────────────────────────────────────────────────────────── */

const MochiSprite = memo(function MochiSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  return (
    <PetSvg {...props}>
      <g className="mc-pet-antenna">
        <line x1="50" y1="26" x2="50" y2="16" />
        <path
          className="mc-pet-antenna-tip"
          d="M 50 13 C 48 8.5 42.5 9.8 43.8 13.8 C 44.5 16 47.5 18 50 19.8 C 52.5 18 55.5 16 56.2 13.8 C 57.5 9.8 52 8.5 50 13 Z"
        />
        <Sparkle level={level} />
      </g>
      <path
        className="mc-pet-body"
        d="M 50 90 C 25 90 13 77 15 59 C 18 38 34 26 50 26 C 66 26 82 38 85 59 C 87 77 75 90 50 90 Z"
      />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 74, halfW: 26 },
          belt: { y: 84, halfW: 21 },
          crown: { x: 32, y: 26, tilt: -18 },
        }}
      />
      <StubArms up={mood === "celebrating"} />
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={55} />
        <Mouth mood={mood} y={67} />
        <Blush y={64} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

/**
 * Bunny is the articulation pilot: every part (ears, paws, feet, tail, gaze)
 * lives in its own pivoted <g> so CSS can choreograph parts per mood on top
 * of the whole-body motion on the svg root. See "articulated parts" in
 * styles.css. Other species keep static parts until they adopt this grammar.
 */
const BunnySprite = memo(function BunnySprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  const earsUp = mood === "alert" || mood === "celebrating";
  const armsUp = mood === "celebrating";
  return (
    <PetSvg {...props}>
      <g className="mc-pet-ear mc-pet-ear-l">
        <path
          className="mc-pet-body"
          d="M 34 38 C 28 30 24 17 28 9 C 31 4 37 7 38 16 C 39 25 38 32 37 37 Z"
        />
        <path
          className="mc-pet-inner"
          d="M 33 32 C 30 26 29 17 31 12 C 33 9 35 12 35 18 C 36 25 35 29 34 33 Z"
        />
      </g>
      {earsUp ? (
        <g className="mc-pet-ear mc-pet-ear-r">
          <path
            className="mc-pet-body"
            d="M 66 38 C 72 30 76 17 72 9 C 69 4 63 7 62 16 C 61 25 62 32 63 37 Z"
          />
          <path
            className="mc-pet-inner"
            d="M 67 32 C 70 26 71 17 69 12 C 67 9 65 12 65 18 C 64 25 65 29 66 33 Z"
          />
        </g>
      ) : (
        <g className="mc-pet-ear mc-pet-ear-r mc-pet-ear-flop">
          <path
            className="mc-pet-body"
            d="M 63 37 C 68 30 78 22 85 22 C 90 23 89 29 83 32 C 76 36 69 38 65 39 Z"
          />
          <path
            className="mc-pet-inner"
            d="M 69 34 C 74 30 80 27 83 27 C 85 28 84 30 80 31 C 76 33 72 34 70 35 Z"
          />
        </g>
      )}
      <Sparkle level={level} dx={20} />
      <path
        className="mc-pet-body"
        d="M 50 90 C 26 90 14 78 16 62 C 18 44 33 32 50 32 C 67 32 82 44 84 62 C 86 78 74 90 50 90 Z"
      />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 78, halfW: 24 },
          belt: { y: 85, halfW: 20 },
          crown: { x: 50, y: 28 },
        }}
      />
      <g className="mc-pet-tail-grp">
        <circle className="mc-pet-tail" cx="87" cy="80" r="3.6" />
      </g>
      <g className="mc-pet-arms">
        <g className="mc-pet-arm mc-pet-arm-l">
          <path d={armsUp ? "M 18 56 Q 8 48 10 42" : "M 17 62 Q 9 66 12 72"} />
        </g>
        <g className="mc-pet-arm mc-pet-arm-r">
          <path d={armsUp ? "M 82 56 Q 92 48 90 42" : "M 83 62 Q 91 66 88 72"} />
        </g>
      </g>
      <g className="mc-pet-feet">
        <g className="mc-pet-foot mc-pet-foot-l">
          <path d="M 38 90 Q 38 86 42 86" />
        </g>
        <g className="mc-pet-foot mc-pet-foot-r">
          <path d="M 62 90 Q 62 86 58 86" />
        </g>
      </g>
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={58} />
        <Mouth mood={mood} y={70} />
        <Blush y={66} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

const ChickSprite = memo(function ChickSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  const excited = mood === "celebrating" || mood === "alert" || mood === "startled";
  return (
    <PetSvg {...props}>
      <path
        className="mc-pet-body"
        d="M 50 90 C 26 90 14 76 16 58 C 18 40 33 28 50 28 C 67 28 82 40 84 58 C 86 76 74 90 50 90 Z"
      />
      <path
        className="mc-pet-patch"
        d="M 50 88 C 36 88 28 80 28 70 C 28 60 38 54 50 54 C 62 54 72 60 72 70 C 72 80 64 88 50 88 Z"
      />
      <g className="mc-pet-tuft">
        <path className="mc-pet-plume" d="M 46 28 Q 43 20 38 18" />
        <path className="mc-pet-plume" d="M 50 27 Q 50 17 50 14" />
        <path className="mc-pet-plume" d="M 54 28 Q 57 20 62 18" />
      </g>
      <Sparkle level={level} dx={14} />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 74, halfW: 25 },
          belt: { y: 83, halfW: 21 },
          crown: { x: 30, y: 26, tilt: -20 },
        }}
      />
      {excited ? (
        <>
          <path className="mc-pet-beak" d="M 45 60 L 50 57 L 55 60 L 50 63 Z" />
          <path className="mc-pet-beak" d="M 46 62 L 50 64 L 54 62 L 50 68 Z" opacity={0.85} />
        </>
      ) : (
        <path className="mc-pet-beak" d="M 45 60 L 50 57 L 55 60 Q 50 66 45 60 Z" />
      )}
      <StubArms up={mood === "celebrating"} />
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={50} lx={37} rx={63} />
        <Blush y={60} lx={27} rx={73} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

const CubSprite = memo(function CubSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  return (
    <PetSvg {...props}>
      <circle className="mc-pet-body" cx="29" cy="33" r="7.5" />
      <circle className="mc-pet-inner" cx="29" cy="33" r="3.6" />
      <circle className="mc-pet-body" cx="71" cy="33" r="7.5" />
      <circle className="mc-pet-inner" cx="71" cy="33" r="3.6" />
      <Sparkle level={level} />
      <path
        className="mc-pet-body"
        d="M 50 90 C 22 90 10 76 13 58 C 16 40 32 30 50 30 C 68 30 84 40 87 58 C 90 76 78 90 50 90 Z"
      />
      <ellipse className="mc-pet-patch" cx="50" cy="66" rx="9.5" ry="7" />
      <path
        className="mc-pet-nose"
        d="M 47.4 61.5 Q 50 59.8 52.6 61.5 Q 52.4 64.4 50 65.4 Q 47.6 64.4 47.4 61.5 Z"
      />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 78, halfW: 25 },
          belt: { y: 85, halfW: 21 },
          crown: { x: 50, y: 27 },
        }}
      />
      <g className="mc-pet-arms">
        {mood === "celebrating" ? (
          <>
            <path d="M 20 52 Q 10 44 12 38" />
            <path d="M 80 52 Q 90 44 88 38" />
          </>
        ) : (
          <>
            <path d="M 24 76 Q 28 71 33 75" />
            <path d="M 67 75 Q 72 71 76 76" />
          </>
        )}
      </g>
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={54} lx={35} rx={65} />
        <Mouth mood={mood} y={69} />
        <Blush y={62} lx={24} rx={76} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

function GillFrond({ x1, y1, x2, y2, right }: { x1: number; y1: number; x2: number; y2: number; right?: boolean }) {
  return (
    <g className={right ? "mc-pet-gill mc-pet-gill-r" : "mc-pet-gill"}>
      <path className="mc-pet-plume" d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${y1 - 6} ${x2} ${y2}`} />
      <circle className="mc-pet-antenna-tip" cx={x2} cy={y2} r={2.2} />
    </g>
  );
}

const LotlSprite = memo(function LotlSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  const smile =
    mood === "sleeping" ? (
      <path className="mc-pet-mouth" d="M 44 66 Q 50 70 56 66" />
    ) : mood === "startled" ? (
      <path className="mc-pet-mouth" d="M 42 67 Q 46 64 50 67 Q 54 70 58 67" />
    ) : (
      <path className="mc-pet-mouth" d="M 40 64 Q 50 73 60 64" />
    );
  return (
    <PetSvg {...props}>
      <GillFrond x1={24} y1={36} x2={12} y2={28} />
      <GillFrond x1={20} y1={44} x2={7} y2={40} />
      <GillFrond x1={21} y1={52} x2={10} y2={52} />
      <GillFrond x1={76} y1={36} x2={88} y2={28} right />
      <GillFrond x1={80} y1={44} x2={93} y2={40} right />
      <GillFrond x1={79} y1={52} x2={90} y2={52} right />
      <Sparkle level={level} />
      <path
        className="mc-pet-body"
        d="M 50 90 C 24 90 12 76 15 57 C 18 37 34 27 50 27 C 66 27 82 37 85 57 C 88 76 76 90 50 90 Z"
      />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 77, halfW: 25 },
          belt: { y: 84, halfW: 21 },
          crown: { x: 50, y: 25, tilt: 12 },
        }}
      />
      <StubArms up={mood === "celebrating"} />
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={54} />
        {smile}
        <Blush y={63} lx={28} rx={71} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

const RivetSprite = memo(function RivetSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  return (
    <PetSvg {...props}>
      <g className="mc-pet-antenna">
        <line x1="50" y1="30" x2="50" y2="17" />
        <circle className="mc-pet-antenna-tip" cx="50" cy="14" r="3.4" />
        <Sparkle level={level} />
      </g>
      <rect className="mc-pet-body" x="13" y="50" width="8" height="16" rx="3.5" />
      <rect className="mc-pet-body" x="79" y="50" width="8" height="16" rx="3.5" />
      <rect className="mc-pet-body" x="22" y="30" width="56" height="60" rx="17" />
      <circle className="mc-pet-bolt" cx="30" cy="38" r="1.4" />
      <circle className="mc-pet-bolt" cx="70" cy="38" r="1.4" />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 74, halfW: 24 },
          belt: { y: 82, halfW: 23 },
          crown: { x: 32, y: 27, tilt: -15 },
        }}
      />
      <StubArms up={mood === "celebrating"} />
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={54} />
        <Mouth mood={mood} y={66} />
        <Blush y={63} lx={29} rx={71} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

const TrundleSprite = memo(function TrundleSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  return (
    <PetSvg {...props}>
      <g className="mc-pet-antenna">
        <line x1="50" y1="32" x2="50" y2="19" />
        <circle className="mc-pet-detail" cx="50" cy="14.5" r="3.4" />
        <Sparkle level={level} />
      </g>
      <rect className="mc-pet-body" x="25" y="32" width="50" height="48" rx="15" />
      {/* Wheels stand in for feet; hubs use the bolt dot. */}
      <circle className="mc-pet-body" cx="37" cy="84" r="6" />
      <circle className="mc-pet-bolt" cx="37" cy="84" r="1.7" />
      <circle className="mc-pet-body" cx="63" cy="84" r="6" />
      <circle className="mc-pet-bolt" cx="63" cy="84" r="1.7" />
      <g className="mc-pet-detail">
        <line x1="31" y1="73" x2="37" y2="73" />
        <line x1="63" y1="73" x2="69" y2="73" />
      </g>
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 66, halfW: 23 },
          belt: { y: 74, halfW: 22 },
          crown: { x: 33, y: 29, tilt: -15 },
        }}
      />
      <g className="mc-pet-arms">
        {mood === "celebrating" ? (
          <>
            <path d="M 24 48 Q 14 40 16 34" />
            <path d="M 76 48 Q 86 40 84 34" />
          </>
        ) : (
          <>
            <path d="M 24 58 Q 16 62 19 68" />
            <path d="M 76 58 Q 84 62 81 68" />
          </>
        )}
      </g>
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={50} />
        <Mouth mood={mood} y={62} />
        <Blush y={59} lx={31} rx={69} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

/**
 * Ember — the molt-exclusive species: a small flame spirit whose body rises
 * to a flame-tip head, with an inner glow and drifting ember motes. Only a
 * pet that has molted at the level cap may wear it (see isPetSpeciesUnlocked).
 */
const EmberSprite = memo(function EmberSprite(props: PetSpriteProps) {
  const { mood, intensity, level } = props;
  return (
    <PetSvg {...props}>
      {/* Motes rising off the flame; CSS drifts them upward on a loop. */}
      <g className="mc-pet-ember-motes">
        <circle cx="33" cy="24" r="1.6" />
        <circle cx="64" cy="18" r="1.3" />
        <circle cx="55" cy="10" r="1.1" />
      </g>
      <Sparkle level={level} dx={14} />
      <path
        className="mc-pet-body"
        d="M 50 90 C 27 90 15 76 17 59 C 19 44 30 33 41 25 C 45 22 48 16 50 9 C 52 16 55 22 59 25 C 70 33 81 44 83 59 C 85 76 73 90 50 90 Z"
      />
      <path
        className="mc-pet-flame-core"
        d="M 50 87 C 39 87 32 80 33 70 C 34 61 43 55 50 47 C 57 55 66 61 67 70 C 68 80 61 87 50 87 Z"
      />
      <LevelGear
        level={level}
        spec={{
          scarf: { y: 77, halfW: 25 },
          belt: { y: 84, halfW: 20 },
          crown: { x: 33, y: 27, tilt: -18 },
        }}
      />
      <StubArms up={mood === "celebrating"} />
      {FEET}
      <g className="mc-pet-face">
        <Eyes kind={eyeKindFor(mood)} y={57} />
        <Mouth mood={mood} y={69} />
        <Blush y={66} lx={29} rx={71} />
      </g>
      <MoodProps mood={mood} intensity={intensity} />
    </PetSvg>
  );
});

/* ── registry ────────────────────────────────────────────────────────── */

export type PetSpecies = {
  id: PetSpeciesId;
  label: string;
  Sprite: (props: PetSpriteProps) => ReactNode;
};

export const PET_SPECIES: Record<PetSpeciesId, PetSpecies> = {
  mochi: { id: "mochi", label: "Mochi", Sprite: MochiSprite },
  bunny: { id: "bunny", label: "Bunny", Sprite: BunnySprite },
  chick: { id: "chick", label: "Chick", Sprite: ChickSprite },
  cub: { id: "cub", label: "Cub", Sprite: CubSprite },
  lotl: { id: "lotl", label: "Axolotl", Sprite: LotlSprite },
  rivet: { id: "rivet", label: "Rivet", Sprite: RivetSprite },
  trundle: { id: "trundle", label: "Trundle", Sprite: TrundleSprite },
  ember: { id: "ember", label: "Ember", Sprite: EmberSprite },
};
