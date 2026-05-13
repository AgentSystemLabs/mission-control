import { Icon } from "~/components/ui/Icon";
import type { GitChangedFile } from "~/server/services/git";
import { STATUS_META, displayPath, iconBtnStyle } from "./constants";

export function FileRow({
  file,
  isStaged,
  isSelected,
  isBusy,
  onSelect,
  onAction,
  onContextMenu,
}: {
  file: GitChangedFile;
  isStaged: boolean;
  isSelected: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onAction: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { letter: statusLetter, color: statusColor } = STATUS_META[file.status];
  const display = displayPath(file.path);
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      aria-pressed={isSelected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px 5px 12px",
        cursor: "pointer",
        background: isSelected ? "var(--surface-2)" : "transparent",
        opacity: isBusy ? 0.5 : 1,
        transition: "background 0.08s",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          e.currentTarget.style.background = "var(--surface-1)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
            fontSize: 12,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textAlign: "left",
          }}
          title={file.path}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: "0 1 auto",
            }}
          >
            {display.basename}
          </span>
          {display.dir && (
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: "1 1 auto",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 10,
              }}
            >
              &lt;{display.dir}&gt;
            </span>
          )}
        </div>
      </div>
      <span
        title={file.status}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 600,
          color: statusColor,
          width: 12,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {statusLetter}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        disabled={isBusy}
        title={isStaged ? "Unaccept" : "Accept"}
        aria-label={isStaged ? `Unaccept ${file.path}` : `Accept ${file.path}`}
        style={iconBtnStyle}
      >
        <Icon name={isStaged ? "x" : "plus"} size={11} />
      </button>
    </div>
  );
}
