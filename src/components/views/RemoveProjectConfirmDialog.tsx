import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

/** Shared "Remove project" confirmation — same copy from the dashboard and the project page. */
export function RemoveProjectConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading,
  projectName,
  projectPath,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  projectName: string | undefined;
  projectPath: string | undefined;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Remove project"
      confirmLabel="Remove"
      icon="trash"
      loading={loading}
      width={460}
    >
      <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
        Remove &ldquo;{projectName}&rdquo; from MissionControl?
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
        This only unlinks the project — the files at {projectPath} are not touched.
      </div>
    </ConfirmDialog>
  );
}
