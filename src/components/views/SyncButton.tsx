import { useCallback } from "react";
import { Btn } from "~/components/ui/Btn";

/**
 * The trailing half of the branch split-button. Appears fused to the right edge
 * of the branch selector only when the current branch is behind its upstream.
 * Clicking opens an AI session (configured in Settings → Defaults → Sync) that
 * pulls the upstream changes in — stash/commit, conflict resolution, stash-pop.
 * Sibling of {@link CommitPushButton} (the Ship half); shares its attach class.
 */
export function SyncButton({
  behindCount,
  attachedLeading = false,
  enabled = true,
  onSync,
}: {
  /** Commits the upstream has that HEAD lacks — shown as the badge count. */
  behindCount: number;
  /** Left-attached when fused after the branch selector (drops the left edge). */
  attachedLeading?: boolean;
  enabled?: boolean;
  onSync: () => void;
}) {
  const onClick = useCallback(() => {
    if (!enabled) return;
    onSync();
  }, [enabled, onSync]);

  const plural = behindCount === 1 ? "commit" : "commits";
  const tooltip = !enabled
    ? "Sync unavailable in sandbox sessions"
    : `${behindCount} ${plural} behind upstream — open an AI session to pull and sync`;
  // Accessible name leads with the visible "Sync" label (WCAG 2.5.3, Label in
  // Name) so voice-control "click Sync" matches; the full description stays on
  // the hover title.
  const ariaLabel = !enabled
    ? "Sync (unavailable in sandbox sessions)"
    : `Sync — ${behindCount} ${plural} behind upstream`;

  const className = attachedLeading ? "mc-btn-attached-left" : undefined;

  return (
    <Btn
      variant="gray-frame"
      size="md"
      icon="download"
      className={className}
      onClick={onClick}
      disabled={!enabled}
      title={tooltip}
      aria-label={ariaLabel}
      style={{ fontFamily: "var(--mono)" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        Sync
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 16,
            height: 16,
            padding: "0 5px",
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--accent-ink)",
            background: "color-mix(in srgb, var(--accent) 20%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
          }}
        >
          {behindCount}
        </span>
      </span>
    </Btn>
  );
}
