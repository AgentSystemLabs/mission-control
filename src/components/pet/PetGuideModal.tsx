import type { CSSProperties, ReactNode } from "react";
import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import {
  DEFAULT_PET_NAME,
  PET_MAX_LEVEL,
  PET_EVOLUTION_LEVELS,
  PET_DRIFT_LIMIT,
  xpForNextLevel,
} from "~/shared/pet";
import { PET_XP_AWARDS } from "~/lib/pet/pet-store";

/**
 * "How the pet works" — a field guide opened from the Mission Pet settings.
 * Everything here reads from the same constants the store grants from
 * (PET_XP_AWARDS, level thresholds via xpForNextLevel), so the numbers shown
 * are always the numbers in effect.
 */

const XP_SOURCES: ReadonlyArray<{ label: string; detail: string; xp: number }> = [
  { label: "PR created", detail: "An agent opens a pull request", xp: PET_XP_AWARDS.prCreated },
  { label: "Ship success", detail: "A push lands cleanly", xp: PET_XP_AWARDS.shipSuccess },
  {
    label: "Long session",
    detail: "A finished session that ran long",
    xp: PET_XP_AWARDS.sessionFinishedLong,
  },
  {
    label: "Session finished",
    detail: "Any agent session wraps up",
    xp: PET_XP_AWARDS.sessionFinished,
  },
  {
    label: "Memory learned",
    detail: "Recall saves a new project fact",
    xp: PET_XP_AWARDS.memoryLearned,
  },
  { label: "Petting", detail: "Click the pet (rate-limited — no farming)", xp: PET_XP_AWARDS.petting },
];

const TRAITS: ReadonlyArray<{ name: string; flavor: string; grows: string }> = [
  {
    name: "Snark",
    flavor: "Dry, sarcastic lines",
    grows: "Grows by surviving failure streaks — and by being spam-clicked dizzy.",
  },
  {
    name: "Wisdom",
    flavor: "Practical, advice-flavored lines",
    grows: "Grows each time Recall learns a new memory.",
  },
  {
    name: "Chaos",
    flavor: "Absurdist lines",
    grows: "Grows when you run a whole fleet of agents at once.",
  },
  {
    name: "Zen",
    flavor: "Calm, understated lines",
    grows: "Grows through long sessions and marathon uptimes.",
  },
];

function interactionsFor(name: string): ReadonlyArray<{ action: string; result: ReactNode }> {
  return [
    {
      action: "Click",
      result:
        "Pet it — hearts, a line, a trickle of XP. If a session is blocked, the click jumps you to it instead.",
    },
    {
      action: "Right-click",
      result: "Open the stats card — level, XP, personality, lifetime counters.",
    },
    {
      action: "Call its name",
      result: (
        <>
          Mention it in any session prompt — <Quote>{name}, show your stats</Quote> opens the
          stats card. It also answers to <Quote>dance</Quote>, <Quote>sing</Quote>, and{" "}
          <Quote>sleep</Quote> — a short nap that agent chatter can&apos;t interrupt; only a
          blocked session (or petting it) wakes it early.
        </>
      ),
    },
    { action: "Hold + rub", result: "Stroke it. It notices." },
    { action: "Drag", result: "Pick it up and toss it. It sits dazed where it lands, then trots home." },
  ];
}

/** An inline "type this" phrase — mono and slightly lifted off the prose. */
function Quote({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--text)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "1px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

const sectionTitleStyle: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

function XpBadge({ xp }: { xp: number }) {
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--accent)",
        background: "var(--accent-faint)",
        borderRadius: 4,
        padding: "2px 6px",
        whiteSpace: "nowrap",
      }}
    >
      +{xp} xp
    </span>
  );
}

/** The ten levels as a track: cumulative XP under each, evolutions marked. */
function LevelTrack() {
  const levels = Array.from({ length: PET_MAX_LEVEL }, (_, i) => {
    const level = i + 1;
    // Cumulative XP required to reach this level (level 1 is free).
    const threshold = level === 1 ? 0 : (xpForNextLevel(level - 1) ?? 0);
    return { level, threshold, evolves: PET_EVOLUTION_LEVELS.has(level) };
  });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${PET_MAX_LEVEL}, 1fr)`,
        gap: 3,
      }}
    >
      {levels.map(({ level, threshold, evolves }) => (
        <div
          key={level}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "6px 2px",
            borderRadius: 6,
            border: `1px solid ${evolves ? "var(--accent)" : "var(--border)"}`,
            background: evolves ? "var(--accent-faint)" : "transparent",
          }}
          title={
            level === PET_MAX_LEVEL
              ? "Max level — the pet may molt"
              : evolves
                ? "Evolution — a permanent new detail"
                : undefined
          }
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: 600,
              color: evolves ? "var(--accent)" : "var(--text)",
            }}
          >
            {level === PET_MAX_LEVEL ? "★" : level}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-dim)" }}>
            {threshold}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PetGuideModal({
  open,
  onClose,
  petName,
}: {
  open: boolean;
  onClose: () => void;
  /** The pet's current name, used in the "call its name" example. */
  petName?: string;
}) {
  const interactions = interactionsFor(petName?.trim() || DEFAULT_PET_NAME);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="sparkles" size={13} />
          How the pet works
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22, fontSize: 12.5, lineHeight: 1.55 }}>
        <p style={{ margin: 0, color: "var(--text-dim)" }}>
          The pet has no care chores — your work is its life. It earns XP only from real agent
          activity, and its character is shaped by how your sessions tend to go.
        </p>

        <Section title="Interacting">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {interactions.map(({ action, result }) => (
              <div key={action} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    minWidth: 96,
                    flexShrink: 0,
                    color: "var(--text)",
                  }}
                >
                  {action}
                </span>
                <span style={{ color: "var(--text-dim)" }}>{result}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Earning XP">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {XP_SOURCES.map(({ label, detail, xp }) => (
              <div key={label} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <XpBadge xp={xp} />
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ color: "var(--text-dim)" }}>— {detail}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={`Levels 1–${PET_MAX_LEVEL}`}>
          <LevelTrack />
          <p style={{ margin: 0, color: "var(--text-dim)" }}>
            The number under each level is the total XP to reach it. Highlighted levels are{" "}
            <strong style={{ color: "var(--text)" }}>evolutions</strong> — the pet gains a
            permanent new detail. At level {PET_MAX_LEVEL} it may{" "}
            <strong style={{ color: "var(--text)" }}>molt</strong>: back to level 1 with a
            forever ★, everything lived-in kept, and the Ember species unlocked.
          </p>
        </Section>

        <Section title="Personality">
          <p style={{ margin: 0, color: "var(--text-dim)" }}>
            The four traits are rolled once at hatch (0–10 each) and pick which flavor of
            lines the pet favors. Experience slowly bends each trait — at most ±
            {PET_DRIFT_LIMIT} points, over weeks of real work, never an afternoon. A ▲ or ▼
            on the stats card marks a trait that has drifted from its rolled base.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {TRAITS.map(({ name, flavor, grows }) => (
              <div
                key={name}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600 }}>
                  {name}
                </span>
                <span style={{ fontSize: 11, fontStyle: "italic", color: "var(--text-dim)" }}>
                  {flavor}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{grows}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Modal>
  );
}
