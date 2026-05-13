import { Icon } from "~/components/ui/Icon";

export function FileContextMenu({
  x,
  y,
  onDelete,
}: {
  x: number;
  y: number;
  onDelete: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="File actions"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 1000,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 4,
        minWidth: 140,
        boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
      }}
    >
      <button
        type="button"
        role="menuitem"
        autoFocus
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "7px 10px",
          background: "transparent",
          border: 0,
          borderRadius: 4,
          cursor: "pointer",
          color: "var(--status-failed, #e06c75)",
          fontSize: 12,
          fontFamily: "var(--mono)",
          textAlign: "left",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--surface-3)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
      >
        <Icon name="trash" size={12} /> Delete
      </button>
    </div>
  );
}
