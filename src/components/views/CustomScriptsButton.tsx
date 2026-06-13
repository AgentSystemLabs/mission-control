import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Tooltip } from "~/components/ui/Tooltip";
import { Z_INDEX } from "~/lib/z-index";
import type { CustomScript } from "~/shared/domain";

/** Truncated label so a long script name can't blow out the header width. */
function ScriptLabel({ name }: { name: string }) {
  return (
    <span
      style={{
        maxWidth: 140,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </span>
  );
}

/**
 * Standalone header control for project custom scripts. Renders nothing with no
 * scripts, a single run button for one script, and a primary + chevron-dropdown
 * split for several. The first script is always the primary action; the rest live
 * in the dropdown.
 */
export function CustomScriptsButton({
  scripts,
  onRun,
  disabled = false,
}: {
  scripts: CustomScript[];
  onRun: (script: CustomScript) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close the menu if the script set shrinks out from under it.
  useEffect(() => {
    if (scripts.length <= 1) setOpen(false);
  }, [scripts.length]);

  if (scripts.length === 0) return null;

  const primary = scripts[0]!;
  const rest = scripts.slice(1);
  const hasMenu = rest.length > 0;

  const run = (script: CustomScript) => {
    setOpen(false);
    onRun(script);
  };

  return (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
      <Tooltip content={disabled ? "Unavailable until the project folder is valid" : `Run ${primary.name}`}>
        <Btn
          variant="gray-frame"
          size="md"
          icon="play"
          className={hasMenu ? "mc-btn-attached-right" : undefined}
          onClick={() => run(primary)}
          disabled={disabled}
          aria-label={`Run ${primary.name}`}
          style={{ fontFamily: "var(--mono)" }}
        >
          <ScriptLabel name={primary.name} />
        </Btn>
      </Tooltip>
      {hasMenu && (
        <Btn
          variant="gray-frame"
          size="md"
          icon="chevron-down"
          className="mc-btn-attached-left"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More scripts"
          title="More scripts"
          style={{ minWidth: 36, paddingInline: 0 }}
        />
      )}
      {open &&
        menuRect &&
        hasMenu &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="More scripts"
            solid
            style={{
              position: "fixed",
              top: menuRect.top,
              right: menuRect.right,
              minWidth: 200,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 4,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            {rest.map((script) => (
              <Btn
                key={script.id}
                role="menuitem"
                variant="ghost"
                icon="play"
                onClick={() => run(script)}
                title={script.command}
                style={{ justifyContent: "flex-start" }}
              >
                <span
                  style={{
                    flex: 1,
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {script.name}
                </span>
              </Btn>
            ))}
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}
