import type { ReactNode } from "react";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { DEFAULT_BRANCH } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { GitStatus } from "~/server/services/git";
import { ProjectMenus } from "./ProjectMenus";
import { ProjectGitStatusButton } from "./ProjectGitStatusButton";

export function ProjectPageHeader({
  project,
  gitStatus,
  hasRunningLaunch,
  stopping,
  stopLaunch,
  pinning,
  toggleProjectPin,
  openDiffView,
  setShowLaunchConfig,
  setShowEdit,
  setConfirmRemove,
  setFileFinderOpen,
  headerActions,
}: {
  project: Project;
  gitStatus: GitStatus | undefined;
  hasRunningLaunch: boolean;
  stopping: boolean;
  stopLaunch: () => Promise<void> | void;
  pinning: boolean;
  toggleProjectPin: () => Promise<void> | void;
  openDiffView: () => void;
  setShowLaunchConfig: (v: boolean) => void;
  setShowEdit: (v: boolean) => void;
  setConfirmRemove: (v: boolean) => void;
  setFileFinderOpen: (v: boolean) => void;
  headerActions: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        rowGap: 10,
        flexWrap: "wrap",
        marginBottom: 24,
      }}
    >
      <ProjectMenus
        project={project}
        gitStatus={gitStatus}
        hasRunningLaunch={hasRunningLaunch}
        stopping={stopping}
        stopLaunch={stopLaunch}
        pinning={pinning}
        toggleProjectPin={toggleProjectPin}
        openDiffView={openDiffView}
        setShowLaunchConfig={setShowLaunchConfig}
        setShowEdit={setShowEdit}
        setConfirmRemove={setConfirmRemove}
      />
      {headerActions}
      <div
        role="group"
        aria-label="Review changes and commit"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0,
          maxWidth: 480,
          minWidth: 0,
        }}
      >
        <ProjectGitStatusButton
          branch={gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH}
          changedCount={gitStatus?.changedCount}
          onClick={openDiffView}
        />
        <CommitPushButton projectId={project.id} size="md" splitTrailing />
      </div>
      <div style={{ flex: 1 }} />
      <HotkeyTooltip action="file.finder" label="Find file in project">
        <Btn
          variant="ghost"
          icon="search"
          onClick={() => setFileFinderOpen(true)}
          aria-label="Find file in project"
        />
      </HotkeyTooltip>
    </div>
  );
}
