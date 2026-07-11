import { useEffect, useRef, useState } from "react";
import {
  favoriteProjectOf,
  xpForNextLevel,
  PET_MAX_LEVEL,
  type PetPersistentState,
  type PetPersonality,
} from "~/shared/pet";
import { petMolt } from "~/lib/pet/pet-store";
import { PET_SPECIES } from "./PetSprite";

/**
 * The pet's life, quantified — opened by right-clicking the pet or asking it
 * for "stats" by name. Pure read of the persistent identity: lifetime
 * counters, personality (with experience drift), hatch date, favorite
 * project. Rendered inside the pet walker so it travels with the pet.
 */

const STAT_LABELS: ReadonlyArray<[keyof PetPersonality, string]> = [
  ["snark", "Snark"],
  ["wisdom", "Wisdom"],
  ["chaos", "Chaos"],
  ["zen", "Zen"],
];

function formatHatchDate(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PetStatsCard({
  state,
  onClose,
}: {
  state: PetPersistentState;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // The molt button arms an inline confirm — it resets level and XP, so a
  // stray right-click-then-click shouldn't do it.
  const [confirmingMolt, setConfirmingMolt] = useState(false);

  // Esc or any pointer-down outside the card closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: Event) => {
      const card = cardRef.current;
      if (!card || !(event.target instanceof Node) || card.contains(event.target)) return;
      // The pet button owns its own toggle (right-click); closing here too
      // would make the two handlers fight over the same click.
      if (event.target instanceof Element && event.target.closest(".mc-pet-button")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [onClose]);

  const speciesLabel = PET_SPECIES[state.species]?.label ?? state.species;
  const nextXp = xpForNextLevel(state.level);
  const ageDays = Math.max(0, Math.floor((Date.now() - state.createdAt) / 86_400_000));
  const favorite = favoriteProjectOf(state.projectXp);
  const { stats } = state;

  const counters: ReadonlyArray<[string, number]> = [
    ["Sessions watched", stats.sessions],
    ["Long runs", stats.longSessions],
    ["Ships", stats.ships],
    ["PRs", stats.prs],
    ["Memories learned", stats.memories],
    ["Failures survived", stats.failures],
    ["Worst streak", stats.worstStreak],
    ["Times petted", stats.pets],
  ];

  return (
    <div className="mc-pet-stats-card" ref={cardRef} role="dialog" aria-label="Pet stats">
      <div className="mc-pet-stats-head">
        <div>
          <div className="mc-pet-stats-name">
            {state.name}
            {state.prestige > 0 ? (
              <span
                className="mc-pet-stats-prestige"
                title={`Molted ${state.prestige} time${state.prestige === 1 ? "" : "s"}`}
              >
                {state.prestige <= 3 ? "★".repeat(state.prestige) : `★×${state.prestige}`}
              </span>
            ) : null}
          </div>
          <div className="mc-pet-stats-sub">
            {speciesLabel} · hatched {formatHatchDate(state.createdAt)} ({ageDays}d)
          </div>
        </div>
        <button
          type="button"
          className="mc-pet-stats-close"
          onClick={onClose}
          aria-label="Close pet stats"
        >
          ×
        </button>
      </div>

      <div className="mc-pet-stats-level">
        <span>Lv {state.level}</span>
        {nextXp !== null ? (
          <>
            <div
              className="mc-pet-stats-xpbar"
              role="progressbar"
              aria-valuenow={state.xp}
              aria-valuemax={nextXp}
            >
              <div
                className="mc-pet-stats-xpfill"
                style={{ width: `${Math.min(100, Math.round((state.xp / nextXp) * 100))}%` }}
              />
            </div>
            <span className="mc-pet-stats-xptext">
              {state.xp}/{nextXp} xp
            </span>
          </>
        ) : (
          <span className="mc-pet-stats-xptext">max level ({PET_MAX_LEVEL})</span>
        )}
      </div>

      {/* At the cap the pet may molt: begin again at level 1 with a permanent
          star. Everything lived-in survives — only level and XP reset. */}
      {state.level >= PET_MAX_LEVEL ? (
        <div className="mc-pet-stats-molt">
          {confirmingMolt ? (
            <>
              <span className="mc-pet-stats-molt-note">
                Back to level 1 — stats, personality, and favorites stay; the ★ is forever
                {state.prestige === 0 ? ", and Ember unlocks" : ""}.
              </span>
              <div className="mc-pet-stats-molt-actions">
                <button
                  type="button"
                  className="mc-pet-stats-molt-confirm"
                  onClick={() => {
                    petMolt();
                    setConfirmingMolt(false);
                  }}
                >
                  Molt
                </button>
                <button
                  type="button"
                  className="mc-pet-stats-molt-cancel"
                  onClick={() => setConfirmingMolt(false)}
                >
                  Not yet
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="mc-pet-stats-molt-button"
              onClick={() => setConfirmingMolt(true)}
            >
              Molt ★ — begin again
            </button>
          )}
        </div>
      ) : null}

      <div className="mc-pet-stats-personality">
        {STAT_LABELS.map(([key, label]) => {
          const drift = Math.round(state.personalityDrift[key]);
          return (
            <div key={key} className="mc-pet-stats-trait">
              <span className="mc-pet-stats-trait-label">
                {label}
                {/* Experience drift away from the rolled base, once it rounds
                    to a visible whole point. */}
                {drift !== 0 ? (
                  <span className="mc-pet-stats-drift" data-direction={drift > 0 ? "up" : "down"}>
                    {drift > 0 ? "▲" : "▼"}
                  </span>
                ) : null}
              </span>
              <div className="mc-pet-stats-trait-bar">
                <div
                  className="mc-pet-stats-trait-fill"
                  style={{ width: `${state.personality[key] * 10}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <dl className="mc-pet-stats-counters">
        {counters.map(([label, value]) => (
          <div key={label} className="mc-pet-stats-counter">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {favorite ? (
        <div className="mc-pet-stats-favorite">
          Favorite project: <strong>{favorite.name}</strong>
        </div>
      ) : null}
    </div>
  );
}
