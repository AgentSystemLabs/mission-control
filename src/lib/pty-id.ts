const REMOTE_PTY_PREFIX = "rpty-";

export function isRemotePtyId(ptyId: string | null | undefined): boolean {
  return typeof ptyId === "string" && ptyId.startsWith(REMOTE_PTY_PREFIX);
}
