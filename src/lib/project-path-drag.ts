export const PROJECT_PATH_DRAG_MIME = "application/x-mission-control-project-path";

const PATH_NEEDS_QUOTING = /[\s"'\\]/;
const QUOTE_ESCAPE = /"/g;

/** Quote a filesystem path when spaces or shell metacharacters would break paste. */
export function formatPathForTerminalPaste(path: string): string {
  return PATH_NEEDS_QUOTING.test(path) ? `"${path.replace(QUOTE_ESCAPE, '\\"')}"` : path;
}

export function setProjectPathDragData(dataTransfer: DataTransfer, path: string): void {
  dataTransfer.setData(PROJECT_PATH_DRAG_MIME, path);
  dataTransfer.setData("text/plain", path);
  dataTransfer.effectAllowed = "copy";
}

export function isProjectPathDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(PROJECT_PATH_DRAG_MIME) ?? false;
}

export function readProjectPathFromDragEvent(event: DragEvent): string | null {
  const raw =
    event.dataTransfer?.getData(PROJECT_PATH_DRAG_MIME) ||
    event.dataTransfer?.getData("text/plain");
  const path = raw.trim();
  return path.length > 0 ? path : null;
}
