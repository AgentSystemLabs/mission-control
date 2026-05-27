export type PinnedProjectLogoActivity = {
  cliRunningCount: number;
  terminalOpen: boolean;
};

export function shouldFlashPinnedProjectLogo({
  cliRunningCount,
}: PinnedProjectLogoActivity): boolean {
  // Open terminals can have PTYs without a running CLI session lifecycle.
  return cliRunningCount > 0;
}
