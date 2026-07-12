import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  DEFAULT_PET_HOME_SIDE,
  DEFAULT_PET_NAME,
  isPetSpeciesUnlocked,
  PET_HOME_SIDE_IDS,
  PET_MAX_LEVEL,
  PET_SIZE_IDS,
  PET_SPECIES_IDS,
  type PetHomeSide,
  type PetSizeId,
} from "~/shared/pet";
import { petRename, petSetSize, petSetSpecies, usePetSnapshot } from "~/lib/pet/pet-store";
import { getElectron } from "~/lib/electron";
import { PET_SPECIES } from "~/components/pet/PetSprite";
import { PetGuideModal } from "~/components/pet/PetGuideModal";
import { TextField } from "~/components/ui/TextField";

type PetSettingsPatch = Partial<
  Pick<
    AppSettings,
    | "petEnabled"
    | "petMessagesEnabled"
    | "petSoundsEnabled"
    | "petMultiplayerEnabled"
    | "petOverlayEnabled"
    | "petHomeSide"
  >
>;

export function PetSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const petEnabled = settings?.petEnabled ?? true;
  const petMessagesEnabled = settings?.petMessagesEnabled ?? true;
  const petSoundsEnabled = settings?.petSoundsEnabled ?? false;
  const petMultiplayerEnabled = settings?.petMultiplayerEnabled ?? false;
  const petOverlayEnabled = settings?.petOverlayEnabled ?? false;
  const petHomeSide = settings?.petHomeSide ?? DEFAULT_PET_HOME_SIDE;
  const petState = settings?.petState ?? null;
  const [petNameDraft, setPetNameDraft] = useState("");
  const [petGuideOpen, setPetGuideOpen] = useState(false);
  const canOverlay = Boolean(getElectron()?.petOverlay);

  useEffect(() => {
    setPetNameDraft(petState?.name ?? "");
  }, [petState?.name]);

  const updateSettings = async (patch: PetSettingsPatch) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.settings });
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
    }
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      toast.error(error instanceof Error ? error.message : "Could not update pet settings");
    }
  };

  return (
    <SettingsSection
      title="Mission Pet"
      subtitle="An ambient companion that reacts to real agent activity — no care chores, your work is its life."
      headingLevel="h1"
    >
      <Field label="Guide">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Btn variant="frame" size="sm" icon="info" onClick={() => setPetGuideOpen(true)}>
            How the pet works
          </Btn>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            XP sources, levels &amp; evolutions, molting, and personality drift — plus a tip:
            right-click the pet anytime for its live stats card.
          </div>
        </div>
      </Field>
      <PetGuideModal
        open={petGuideOpen}
        onClose={() => setPetGuideOpen(false)}
        petName={petState?.name}
      />
      <Field label="Pet">
        <ToggleRow
          title="Show pet"
          description="A small companion lives in a bottom corner: it works when your agents work, celebrates finished sessions, and hops when one is blocked on you."
          checked={petEnabled}
          onChange={(enabled: boolean) => void updateSettings({ petEnabled: enabled })}
          label="Enable"
        />
      </Field>
      {petEnabled ? (
        <Field label="Home corner">
          <PetHomeSidePicker
            value={petHomeSide}
            onChange={(side) => void updateSettings({ petHomeSide: side })}
          />
        </Field>
      ) : null}
      <Field label="Speech bubbles">
        <ToggleRow
          title="Commentary"
          description="One-liners on real events — finished sessions, ships, blocked agents. Rate-limited so it stays charming."
          checked={petMessagesEnabled}
          onChange={(enabled: boolean) => void updateSettings({ petMessagesEnabled: enabled })}
          disabled={!petEnabled}
          label="Enable"
        />
      </Field>
      <Field label="Sounds">
        <ToggleRow
          title="Level-up chime"
          description="A soft chime when the pet levels up. XP comes only from finished sessions, ships, and PRs."
          checked={petSoundsEnabled}
          onChange={(enabled: boolean) => void updateSettings({ petSoundsEnabled: enabled })}
          disabled={!petEnabled}
          label="Enable"
        />
      </Field>
      <Field label="Multiplayer">
        <ToggleRow
          title="Show teammates' pets"
          description="When you have a running session on a repo, broadcast your pet to anyone else working on the same git repo — and see theirs along the bottom. Only your pet's name and species are ever sent, keyed by a one-way hash of the repo — the raw repo URL, project name, path, and your identity never leave your machine. Nothing connects while this is off."
          checked={petMultiplayerEnabled}
          onChange={(enabled: boolean) => void updateSettings({ petMultiplayerEnabled: enabled })}
          disabled={!petEnabled}
          label="Enable"
        />
      </Field>
      {canOverlay ? (
        <Field label="Desktop">
          <ToggleRow
            title="Let the pet roam your desktop"
            description="Unleash the pet out of this window onto your desktop, floating above other apps. It stays visible when you switch apps or minimize Mission Control — hover it to pet or drag it; clicks anywhere else pass through. Roams your primary display only for now. (Experimental.)"
            checked={petOverlayEnabled}
            onChange={(enabled: boolean) => void updateSettings({ petOverlayEnabled: enabled })}
            disabled={!petEnabled}
            label="Unleash"
          />
        </Field>
      ) : null}
      {petEnabled && petState ? (
        <Field label="Species">
          <PetSpeciesPicker />
        </Field>
      ) : null}
      {petEnabled && petState ? (
        <Field label="Size">
          <PetSizePicker />
        </Field>
      ) : null}
      {petEnabled && petState ? (
        <Field label="Identity">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <TextField
              label="Name"
              value={petNameDraft}
              onChange={setPetNameDraft}
              onBlur={() => {
                // Rename through the store so the live pet updates and the
                // controller persists it (a direct settings write would be
                // overwritten by the store's next debounced save).
                if (petNameDraft.trim()) petRename(petNameDraft);
                else setPetNameDraft(petState.name);
              }}
              placeholder={DEFAULT_PET_NAME}
              spellCheck={false}
            />
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Lv {petState.level} · {petState.xp} XP
              {petState.prestige > 0 ? ` · ★${petState.prestige} molt${petState.prestige === 1 ? "" : "s"}` : ""}
              {petState.level >= PET_MAX_LEVEL
                ? " · max level — right-click the pet to molt"
                : ""}
              <span style={{ margin: "0 6px", opacity: 0.5 }}>—</span>
              Snark {petState.personality.snark} · Wisdom {petState.personality.wisdom} ·
              Chaos {petState.personality.chaos} · Zen {petState.personality.zen}
              <span style={{ margin: "0 6px", opacity: 0.5 }}>—</span>
              personality is rolled once per install
            </div>
          </div>
        </Field>
      ) : null}
    </SettingsSection>
  );
}

/**
 * Live species picker — each option renders that species' actual idle sprite,
 * so what you pick is exactly what wanders the corner. Selection goes through
 * the pet store (petSetSpecies) so the live pet switches instantly and the
 * controller persists it with the rest of the identity.
 */
function PetSpeciesPicker() {
  const pet = usePetSnapshot();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="radiogroup" aria-label="Pet species">
      {PET_SPECIES_IDS.map((id) => {
        const species = PET_SPECIES[id];
        const selected = pet.species === id;
        // Ember is earned, not picked: locked until the pet has molted.
        const locked = !isPetSpeciesUnlocked(id, pet.prestige);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={locked || undefined}
            disabled={locked}
            title={
              locked
                ? "Unlocks after your pet molts — reach level 10, then choose “Molt” on its stats card"
                : undefined
            }
            onClick={() => petSetSpecies(id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "8px 10px 6px",
              borderRadius: 10,
              cursor: locked ? "not-allowed" : "pointer",
              background: selected
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "transparent",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              color: selected ? "var(--text)" : "var(--text-dim)",
              opacity: locked ? 0.45 : 1,
            }}
          >
            <span style={{ filter: locked ? "grayscale(1)" : undefined, lineHeight: 0 }}>
              <species.Sprite mood="idle" intensity={1} night={false} level={1} size={44} />
            </span>
            <span style={{ fontSize: 11 }}>{locked ? `${species.label} 🔒` : species.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const PET_HOME_SIDE_LABELS: Record<PetHomeSide, string> = {
  left: "Bottom left",
  right: "Bottom right",
};

/**
 * Corner picker — keeps the pet off session inputs / toasts when they stack
 * on the opposite side of the window.
 */
function PetHomeSidePicker({
  value,
  onChange,
}: {
  value: PetHomeSide;
  onChange: (side: PetHomeSide) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        role="radiogroup"
        aria-label="Pet home corner"
      >
        {PET_HOME_SIDE_IDS.map((id) => {
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(id)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minWidth: 110,
                padding: "8px 12px 6px",
                borderRadius: 10,
                cursor: "pointer",
                background: selected
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : "transparent",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                color: selected ? "var(--text)" : "var(--text-dim)",
              }}
            >
              <span style={{ fontSize: 11 }}>{PET_HOME_SIDE_LABELS[id]}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
        Pick the corner that stays clear of session inputs and notifications.
      </div>
    </div>
  );
}

const PET_SIZE_LABELS: Record<PetSizeId, string> = { s: "Small", m: "Medium", l: "Large" };
/** Preview sprite sizes — the same S/M/L ratio the corner widget renders at. */
const PET_SIZE_PREVIEW_PX: Record<PetSizeId, number> = { s: 34, m: 44, l: 56 };

/**
 * Size picker in the species-picker style: each option shows the current
 * species' idle sprite at that size's scale. Selection goes through the pet
 * store (petSetSize) so the live pet resizes instantly and the controller
 * persists it with the rest of the identity.
 */
function PetSizePicker() {
  const pet = usePetSnapshot();
  const species = PET_SPECIES[pet.species];
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      role="radiogroup"
      aria-label="Pet size"
    >
      {PET_SIZE_IDS.map((id) => {
        const selected = pet.size === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => petSetSize(id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 2,
              minWidth: 76,
              padding: "8px 10px 6px",
              borderRadius: 10,
              cursor: "pointer",
              background: selected
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "transparent",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              color: selected ? "var(--text)" : "var(--text-dim)",
            }}
          >
            <species.Sprite
              mood="idle"
              intensity={1}
              night={false}
              level={1}
              size={PET_SIZE_PREVIEW_PX[id]}
            />
            <span style={{ fontSize: 11 }}>{PET_SIZE_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
