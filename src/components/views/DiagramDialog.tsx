import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import {
  buildMermaidInitConfig,
  getMissionControlColorScheme,
  watchMissionControlColorScheme,
} from "~/lib/mermaid-theme";
import { useHotkey } from "~/lib/use-hotkey";
import type { DiagramFormat } from "~/shared/diagram";

export type DiagramDialogPayload = {
  id: string;
  taskId: string;
  projectId: string;
  title: string | null;
  source: string;
  format: DiagramFormat;
};

export type DiagramDialogSession = {
  taskId: string;
  projectId: string;
  diagrams: DiagramDialogPayload[];
  activeId: string;
};

function diagramTabLabel(diagram: DiagramDialogPayload, index: number): string {
  const title = diagram.title?.trim();
  if (title) return title;
  return `Diagram ${index + 1}`;
}

type RenderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; svg: string; bindFunctions?: (element: Element) => void }
  | { status: "error"; message: string };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.015;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function DiagramViewport({
  renderKey,
  ready,
  children,
}: {
  renderKey: string;
  ready: boolean;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(
    null,
  );

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setIsPanning(false);
    dragRef.current = null;
  }, [renderKey]);

  const zoomBy = useCallback((delta: number) => {
    setScale((current) => clampZoom(Number((current + delta).toFixed(2))));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
    setScale((current) => clampZoom(Number((current + delta).toFixed(2))));
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0) return;
    event.preventDefault();
    setIsPanning(true);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [offset.x, offset.y, ready]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.ox + (event.clientX - drag.x),
      y: drag.oy + (event.clientY - drag.y),
    });
  }, []);

  const endPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          Scroll to zoom · drag to pan
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Btn variant="ghost" size="sm" onClick={() => zoomBy(-ZOOM_STEP)} disabled={!ready}>
            −
          </Btn>
          <span
            style={{
              minWidth: 52,
              textAlign: "center",
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            {Math.round(scale * 100)}%
          </span>
          <Btn variant="ghost" size="sm" onClick={() => zoomBy(ZOOM_STEP)} disabled={!ready}>
            +
          </Btn>
          <Btn variant="ghost" size="sm" onClick={resetView} disabled={!ready}>
            Reset
          </Btn>
        </div>
      </div>

      <div
        ref={viewportRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "var(--surface-0)",
          position: "relative",
          touchAction: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 80ms ease-out",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {children}
        </div>
        {ready && (
          <div
            aria-hidden
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDragStart={(event) => event.preventDefault()}
            style={{
              position: "absolute",
              inset: 0,
              cursor: isPanning ? "grabbing" : "grab",
              touchAction: "none",
              userSelect: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function DiagramDialog({
  session,
  onClose,
  onSelectDiagram,
}: {
  session: DiagramDialogSession | null;
  onClose: () => void;
  onSelectDiagram: (id: string) => void;
}) {
  const open = session !== null;
  const payload =
    session?.diagrams.find((diagram) => diagram.id === session.activeId) ??
    session?.diagrams[session.diagrams.length - 1] ??
    null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  const [colorScheme, setColorScheme] = useState(getMissionControlColorScheme);
  const renderKey = payload
    ? `${payload.id}:${payload.source.length}:${colorScheme}`
    : "closed";
  const diagramLabelId = useId();

  useEffect(() => watchMissionControlColorScheme(() => {
    setColorScheme(getMissionControlColorScheme());
  }), []);

  useHotkey("dialog.submit", () => onClose(), { enabled: open });
  useHotkey("escape", () => onClose(), { enabled: open, preventDefault: false });

  useEffect(() => {
    if (renderState.status !== "ready" || !containerRef.current) return;

    const root = containerRef.current;
    root.querySelectorAll("svg, svg *").forEach((node) => {
      if (node instanceof SVGElement) {
        node.style.pointerEvents = "none";
        node.style.userSelect = "none";
      }
    });
    root.querySelector("svg")?.setAttribute("draggable", "false");

    renderState.bindFunctions?.(root);
  }, [renderState]);

  useEffect(() => {
    if (!open || !payload) {
      setRenderState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setRenderState({ status: "loading" });

    const diagramId = `mc-diagram-${payload.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(buildMermaidInitConfig(colorScheme));

        const { svg, bindFunctions } = await mermaid.render(diagramId, payload.source);
        if (!cancelled) {
          setRenderState({ status: "ready", svg, bindFunctions });
        }
      } catch (err) {
        // A failed mermaid.render throws before it can remove the temporary
        // measuring container it appends to document.body (id `d<renderId>`),
        // so it accumulates one orphan node per failed/retried render. Remove it.
        document.getElementById(`d${diagramId}`)?.remove();
        const message = err instanceof Error ? err.message : "Failed to render diagram";
        if (!cancelled) setRenderState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [colorScheme, open, payload, renderKey]);

  const copySource = useCallback(async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.source);
    } catch {
      /* ignore */
    }
  }, [payload]);

  const ready = renderState.status === "ready";
  const title = payload?.title?.trim() || "Diagram";

  if (!open) return null;

  const panel = (
    <CardFrame
      as="section"
      solid
      data-navigation-swipe-blocker
      role="dialog"
      aria-modal="true"
      aria-labelledby={diagramLabelId}
      style={{
        position: "fixed",
        top: "var(--mc-workspace-top, 0px)",
        left: "var(--mc-workspace-left, 0px)",
        right: "var(--mc-workspace-right, 0px)",
        bottom: "var(--mc-workspace-bottom, 0px)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        outline: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 16px",
          borderBottom: session && session.diagrams.length > 1 ? "none" : "1px solid var(--border)",
          background: "rgba(3, 6, 8, 0.35)",
          flexShrink: 0,
        }}
      >
        <div
          id={diagramLabelId}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <EscTooltip label="Close">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diagram"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              flexShrink: 0,
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </EscTooltip>
      </div>

      {session && session.diagrams.length > 1 && (
        <div
          role="tablist"
          aria-label="Diagram tabs"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "0 16px 10px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(3, 6, 8, 0.35)",
            flexShrink: 0,
          }}
        >
          {session.diagrams.map((diagram, index) => {
            const active = diagram.id === session.activeId;
            const label = diagramTabLabel(diagram, index);
            return (
              <button
                key={diagram.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`diagram-panel-${diagram.id}`}
                id={`diagram-tab-${diagram.id}`}
                title={label}
                onClick={() => onSelectDiagram(diagram.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 9px",
                  background: active ? "var(--surface-1)" : "transparent",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 4,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: active ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                  maxWidth: 180,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-1)",
        }}
      >
        <DiagramViewport renderKey={renderKey} ready={ready}>
          <div
            ref={containerRef}
            role="img"
            aria-label={title}
            id={payload ? `diagram-panel-${payload.id}` : undefined}
            aria-labelledby={payload ? `diagram-tab-${payload.id}` : diagramLabelId}
            style={{
              width: "100%",
              color: "var(--text)",
            }}
          >
            {renderState.status === "loading" && (
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Rendering diagram…</div>
            )}
            {renderState.status === "error" && (
              <div style={{ maxWidth: 640, width: "100%" }}>
                <div style={{ color: "var(--danger, #f87171)", fontSize: 13, marginBottom: 10 }}>
                  Could not render this diagram.
                </div>
                <div
                  style={{
                    color: "var(--text-dim)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    marginBottom: 12,
                  }}
                >
                  {renderState.message}
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "12px 14px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--surface-1)",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    overflow: "auto",
                    maxHeight: 240,
                  }}
                >
                  {payload?.source}
                </pre>
              </div>
            )}
            {renderState.status === "ready" && (
              <div
                // Mermaid emits trusted SVG for the diagram source we control.
                dangerouslySetInnerHTML={{ __html: renderState.svg }}
                style={{
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            )}
          </div>
        </DiagramViewport>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 18px",
          borderTop: "1px solid var(--border)",
          background: "rgba(3, 6, 8, 0.35)",
          flexShrink: 0,
        }}
      >
        <Btn variant="ghost" onClick={copySource} disabled={!payload} icon="copy">
          Copy source
        </Btn>
        <HotkeyTooltip action="dialog.submit">
          <Btn variant="ghost" onClick={onClose}>
            Close
          </Btn>
        </HotkeyTooltip>
      </div>
    </CardFrame>
  );

  if (typeof document === "undefined") return panel;

  return createPortal(panel, document.body);
}
