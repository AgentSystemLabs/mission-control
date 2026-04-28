import { Btn } from "~/components/ui/Btn";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import type { Project } from "~/db/schema";

export function NewAgentButton({
  project,
  onPrimary,
  onConfigure,
  disabled,
}: {
  project: Project;
  onPrimary: () => void;
  onConfigure: () => void;
  disabled?: boolean;
}) {
  const hotkey = hotkeyLabel("mod+n");
  const remembered = !!(project.rememberAgentSettings && project.savedAgent);

  if (!remembered) {
    return (
      <Btn variant="primary" icon="plus" onClick={onPrimary} disabled={disabled}>
        New agent
        <Kbd variant="onPrimary">{hotkey}</Kbd>
      </Btn>
    );
  }

  return (
    <div style={{ display: "inline-flex" }}>
      <Btn
        variant="primary"
        icon="plus"
        onClick={onPrimary}
        disabled={disabled}
        title={`Start ${project.savedAgent} directly — click the gear to change`}
        style={{ borderRadius: "7px 0 0 7px", borderRight: "none" }}
      >
        New agent
        <Kbd variant="onPrimary">{hotkey}</Kbd>
      </Btn>
      <Btn
        variant="primary"
        icon="settings"
        onClick={onConfigure}
        title="Change agent settings"
        aria-label="Change agent settings"
        style={{
          borderRadius: "0 7px 7px 0",
          padding: 0,
          width: 30,
          borderLeft: "1px solid color-mix(in oklch, var(--accent) 60%, black)",
        }}
      />
    </div>
  );
}
