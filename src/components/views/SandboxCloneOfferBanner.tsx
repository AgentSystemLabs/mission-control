import { Btn } from "~/components/ui/Btn";

export function displayCloneRemote(remote: string): string {
  try {
    const url = new URL(remote);
    if (
      url.password ||
      url.search ||
      url.hash ||
      ((url.protocol === "http:" || url.protocol === "https:") && url.username)
    ) {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    // SCP-style SSH remotes don't parse as URLs and don't carry URL userinfo.
  }
  return remote;
}

export function SandboxCloneOfferBanner({
  remote,
  cloning,
  onConfirm,
}: {
  remote: string;
  cloning: boolean;
  onConfirm: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Clone into sandbox"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        color: "var(--text)",
        background: "var(--accent-faint, var(--accent-dim))",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Not in the sandbox yet — clone {displayCloneRemote(remote)}?
      </span>
      <Btn variant="primary" size="sm" disabled={cloning} onClick={onConfirm}>
        {cloning ? "Cloning…" : "Clone into sandbox"}
      </Btn>
    </div>
  );
}
