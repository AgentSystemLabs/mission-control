import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import { GitDiffView } from "./index";

/**
 * Full-screen modal presentation of the git diff view (mirrors the prompt-search
 * palette / file-finder convention of wrapping the shared `Modal` primitive).
 *
 * This component owns ONLY presentation — sizing, chrome, and open/close wiring.
 * All git state and compute stay inside `GitDiffView`, which is rendered
 * chrome-less (`showHeader={false}`) so the Modal's own title bar + Esc/close
 * are the single source of chrome. Swapping the diff to a drawer, route, or
 * inline panel later means touching this file only.
 */
export function GitDiffModal({
  open,
  projectId,
  worktreeId,
  projectPath,
  enabled = true,
  onClose,
}: {
  open: boolean;
  projectId: string;
  worktreeId?: string | null;
  projectPath: string;
  enabled?: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <Icon name="git-branch" size={12} />
          <span style={{ flexShrink: 0 }}>Review Changes</span>
          <span
            title={projectPath}
            style={{
              marginLeft: "auto",
              minWidth: 0,
              color: "var(--text-faint)",
              fontWeight: 400,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {projectPath}
          </span>
        </div>
      }
      width="min(1600px, 94vw)"
      height="90vh"
      maxWidth="94vw"
      maxHeight="90vh"
      contentStyle={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <GitDiffView
        projectId={projectId}
        worktreeId={worktreeId}
        projectPath={projectPath}
        enabled={enabled}
        onBack={onClose}
        showHeader={false}
      />
    </Modal>
  );
}
