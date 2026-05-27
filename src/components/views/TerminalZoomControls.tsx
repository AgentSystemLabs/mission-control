import { Btn } from "~/components/ui/Btn";
import { TERMINAL_ZOOM_LABELS } from "~/shared/terminal-zoom";

export function TerminalZoomControls({
  level,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}: {
  level: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const label = TERMINAL_ZOOM_LABELS[level as keyof typeof TERMINAL_ZOOM_LABELS] ?? "Default";

  return (
    <>
      <Btn
        variant="ghost"
        size="sm"
        icon="zoom-out"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out terminal text"
        title={`Zoom out (${label})`}
        style={{ width: 34, padding: 0 }}
      />
      <Btn
        variant="ghost"
        size="sm"
        icon="zoom-in"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in terminal text"
        title={`Zoom in (${label})`}
        style={{ width: 34, padding: 0 }}
      />
    </>
  );
}
