import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "~/components/ui/Icon";
import { openExternal } from "~/lib/open-external";

const remarkPlugins = [remarkGfm];

/**
 * Opt-in annotation wiring. When a `MarkdownAnnotationContext` provider is
 * present (the annotate-enabled preview), block renderers grow a hover
 * "+" affordance and highlight annotated blocks. With no provider — every other
 * caller — the preview renders exactly as before.
 */
type MarkdownLineRange = { lineStart: number; lineEnd: number };

export type MarkdownAnnotationApi = {
  /** Source-line ranges that currently have comments. */
  annotatedRanges: readonly MarkdownLineRange[];
  /** Source-line range of the selected comment, for stronger highlight. */
  activeRange: MarkdownLineRange | null;
  onAdd: (anchor: MarkdownLineRange) => void;
  onSelect: (anchor: MarkdownLineRange) => void;
};

export const MarkdownAnnotationContext = createContext<MarkdownAnnotationApi | null>(null);

export function MarkdownPreview({ source, fileName }: { source: string; fileName: string }) {
  const annotationApi = useContext(MarkdownAnnotationContext);
  const articleRef = useRef<HTMLElement>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);

  const refreshSelectionAction = useCallback(() => {
    if (!annotationApi || !articleRef.current) {
      setSelectionAction(null);
      return;
    }
    setSelectionAction(getSelectionAction(articleRef.current));
  }, [annotationApi]);

  const handleAddSelectedRegion = useCallback(() => {
    if (!selectionAction || !annotationApi) return;
    annotationApi.onAdd({ lineStart: selectionAction.lineStart, lineEnd: selectionAction.lineEnd });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }, [annotationApi, selectionAction]);

  if (!source.trim()) return <MarkdownPreviewStatus>Empty markdown file.</MarkdownPreviewStatus>;

  return (
    <article
      ref={articleRef}
      aria-label={fileName ? `Rendered preview of ${fileName}` : "Rendered markdown preview"}
      onMouseDown={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".mc-md-selection-add")) {
          setSelectionAction(null);
        }
      }}
      onMouseUp={() => {
        requestAnimationFrame(refreshSelectionAction);
      }}
      onKeyUp={refreshSelectionAction}
      style={{
        position: "relative",
        minHeight: "100%",
        maxWidth: 860,
        margin: "0 auto",
        padding: "clamp(18px, 3vw, 28px) clamp(18px, 4vw, 36px) 56px",
        color: "var(--text)",
        fontFamily: "var(--sans)",
        fontSize: 14,
        lineHeight: 1.65,
      }}
    >
      {annotationApi && selectionAction && (
        <SelectionCommentButton action={selectionAction} onAdd={handleAddSelectedRegion} />
      )}
      <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} components={markdownComponents}>
        {source}
      </ReactMarkdown>
    </article>
  );
}

function MarkdownPreviewStatus({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: 24,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function openMarkdownLink(href: string): void {
  if (!isHttpUrl(href)) return;
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(href);
    return;
  }
  openExternal(href);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type BlockNode = { position?: { start?: { line?: number }; end?: { line?: number } } } | undefined;

type BlockAnnotation = {
  wrapperProps: {
    className?: string;
    "data-md-line-start"?: number;
    "data-md-line-end"?: number;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
  };
  extraStyle: CSSProperties | undefined;
  affordance: ReactNode;
};

/**
 * Shared per-block annotation wiring. Always calls `useContext` first (so the
 * hook rules hold), then returns no-op wiring when the annotation provider is
 * absent. `inside` places the "+" inside the block (for `pre`, whose overflow
 * would clip a gutter button).
 */
function useBlockAnnotation(node: BlockNode, inside = false): BlockAnnotation {
  const ctx = useContext(MarkdownAnnotationContext);
  const line = node?.position?.start?.line;
  if (!ctx || !line) return { wrapperProps: {}, extraStyle: undefined, affordance: null };

  const endLine = node?.position?.end?.line ?? line;
  const range = { lineStart: line, lineEnd: endLine };
  const annotated = ctx.annotatedRanges.some((annotatedRange) => rangesOverlap(annotatedRange, range));
  const active = ctx.activeRange ? rangesOverlap(ctx.activeRange, range) : false;

  return {
    wrapperProps: {
      className: "mc-md-block",
      "data-md-line-start": line,
      "data-md-line-end": endLine,
      onClick: annotated
        ? (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("a, .mc-md-annot-add")) return;
            ctx.onSelect(range);
          }
        : undefined,
    },
    extraStyle: {
      position: "relative",
      ...(annotated ? blockHighlightStyle(active) : null),
    },
    affordance: (
      <button
        type="button"
        className={inside ? "mc-md-annot-add mc-md-annot-add-inside" : "mc-md-annot-add"}
        aria-label="Add a comment on this section"
        title="Add comment"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          ctx.onAdd(range);
        }}
      >
        <Icon name="plus" size={12} />
      </button>
    ),
  };
}

type SelectionAction = MarkdownLineRange & { top: number; left: number };

function getSelectionAction(root: HTMLElement): SelectionAction | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!selection.toString().trim()) return null;
  if (!selection.anchorNode || !selection.focusNode) return null;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const selectedBlocks = Array.from(
    root.querySelectorAll<HTMLElement>(".mc-md-block[data-md-line-start][data-md-line-end]"),
  ).filter((block) => rangeIntersectsNode(range, block));

  if (selectedBlocks.length === 0) return null;

  let lineStart = Number.POSITIVE_INFINITY;
  let lineEnd = 0;
  for (const block of selectedBlocks) {
    const start = Number(block.dataset.mdLineStart);
    const end = Number(block.dataset.mdLineEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    lineStart = Math.min(lineStart, start);
    lineEnd = Math.max(lineEnd, end);
  }
  if (!Number.isFinite(lineStart) || lineEnd < lineStart) return null;

  const rootRect = root.getBoundingClientRect();
  const selectionRect = range.getBoundingClientRect();
  const left = Math.min(Math.max(selectionRect.right - rootRect.left, 96), rootRect.width - 8);
  const top = Math.max(selectionRect.top - rootRect.top - 36, 4);

  return { lineStart, lineEnd, left, top };
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function rangesOverlap(a: MarkdownLineRange, b: MarkdownLineRange): boolean {
  return a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

function SelectionCommentButton({
  action,
  onAdd,
}: {
  action: SelectionAction;
  onAdd: () => void;
}) {
  const label =
    action.lineEnd > action.lineStart
      ? `Comment on selected lines ${action.lineStart}-${action.lineEnd}`
      : `Comment on selected line ${action.lineStart}`;

  return (
    <button
      type="button"
      className="mc-md-selection-add"
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onAdd();
      }}
      style={{
        position: "absolute",
        top: action.top,
        left: action.left,
        transform: "translateX(-100%)",
        zIndex: 2,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 9px",
        border: "1px solid var(--accent-border)",
        borderRadius: 7,
        background: "var(--surface-2)",
        color: "var(--text)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.32)",
        cursor: "pointer",
        fontFamily: "var(--sans)",
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      <Icon name="plus" size={12} />
      Comment
    </button>
  );
}

function blockHighlightStyle(active: boolean): CSSProperties {
  return {
    background: active ? "var(--accent-dim)" : "color-mix(in srgb, var(--accent) 9%, transparent)",
    boxShadow: `inset 3px 0 0 ${active ? "var(--accent)" : "var(--accent-border)"}`,
    borderRadius: 4,
    paddingLeft: 12,
    marginLeft: -12,
    transition: "background 0.15s",
  };
}

const markdownComponents: Components = {
  h1({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <h1 {...props} {...ann.wrapperProps} style={{ ...headingStyle(1), ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </h1>
    );
  },
  h2({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <h2 {...props} {...ann.wrapperProps} style={{ ...headingStyle(2), ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </h2>
    );
  },
  h3({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <h3 {...props} {...ann.wrapperProps} style={{ ...headingStyle(3), ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </h3>
    );
  },
  h4({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <h4 {...props} {...ann.wrapperProps} style={{ ...headingStyle(4), ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </h4>
    );
  },
  p({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <p {...props} {...ann.wrapperProps} style={{ margin: "0 0 14px", ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </p>
    );
  },
  a({ node: _node, href, ...props }) {
    return (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (!href) return;
          event.preventDefault();
          openMarkdownLink(href);
        }}
        style={{
          color: "var(--accent)",
          textDecoration: "none",
          borderBottom: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
        }}
      />
    );
  },
  ul({ node: _node, ...props }) {
    return <ul {...props} style={listStyle} />;
  },
  ol({ node: _node, ...props }) {
    return <ol {...props} style={listStyle} />;
  },
  li({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <li {...props} {...ann.wrapperProps} style={{ margin: "3px 0", ...ann.extraStyle }}>
        {children}
        {ann.affordance}
      </li>
    );
  },
  blockquote({ node, children, ...props }) {
    const ann = useBlockAnnotation(node);
    return (
      <blockquote
        {...props}
        {...ann.wrapperProps}
        style={{
          margin: "0 0 16px",
          padding: "2px 0 2px 14px",
          borderLeft: "3px solid var(--border-strong)",
          color: "var(--text-dim)",
          ...ann.extraStyle,
        }}
      >
        {children}
        {ann.affordance}
      </blockquote>
    );
  },
  pre({ node, children, ...props }) {
    const ann = useBlockAnnotation(node, true);
    return (
      <pre
        {...props}
        {...ann.wrapperProps}
        style={{
          margin: "0 0 16px",
          padding: 14,
          overflowX: "auto",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--surface-1)",
          color: "var(--text)",
          fontFamily: "var(--mono)",
          fontSize: 12,
          lineHeight: 1.55,
          ...ann.extraStyle,
        }}
      >
        {children}
        {ann.affordance}
      </pre>
    );
  },
  code({ node: _node, className, children, ...props }) {
    const text = String(children);
    const block = className?.startsWith("language-") || text.includes("\n");
    return (
      <code
        {...props}
        className={className}
        style={block ? blockCodeStyle : inlineCodeStyle}
      >
        {children}
      </code>
    );
  },
  table({ node: _node, ...props }) {
    return (
      <div style={{ overflowX: "auto", margin: "0 0 18px" }}>
        <table
          {...props}
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        />
      </div>
    );
  },
  th({ node: _node, ...props }) {
    return <th {...props} style={tableCellStyle(true)} />;
  },
  td({ node: _node, ...props }) {
    return <td {...props} style={tableCellStyle(false)} />;
  },
  hr({ node: _node, ...props }) {
    return (
      <hr
        {...props}
        style={{
          margin: "24px 0",
          border: 0,
          borderTop: "1px solid var(--border)",
        }}
      />
    );
  },
  img({ node: _node, alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ""}
        style={{
          maxWidth: "100%",
          height: "auto",
          borderRadius: 6,
          border: "1px solid var(--border)",
        }}
      />
    );
  },
  input({ node: _node, ...props }) {
    return <input {...props} disabled style={{ margin: "0 7px 0 0", verticalAlign: "-1px" }} />;
  },
};

function headingStyle(level: 1 | 2 | 3 | 4): CSSProperties {
  const sizes = {
    1: 24,
    2: 19,
    3: 16,
    4: 14,
  };
  return {
    margin: level === 1 ? "0 0 18px" : "22px 0 10px",
    paddingBottom: level <= 2 ? 8 : 0,
    borderBottom: level <= 2 ? "1px solid var(--border)" : undefined,
    color: "var(--text)",
    fontSize: sizes[level],
    fontWeight: 600,
    lineHeight: 1.25,
    letterSpacing: 0,
  };
}

const listStyle: CSSProperties = {
  margin: "0 0 14px",
  paddingLeft: 24,
};

const inlineCodeStyle: CSSProperties = {
  padding: "1px 5px",
  borderRadius: 4,
  background: "var(--surface-2)",
  color: "var(--text)",
  fontFamily: "var(--mono)",
  fontSize: "0.88em",
};

const blockCodeStyle: CSSProperties = {
  padding: 0,
  background: "transparent",
  color: "inherit",
  fontFamily: "var(--mono)",
  fontSize: "inherit",
};

function tableCellStyle(header: boolean): CSSProperties {
  return {
    padding: "7px 9px",
    border: "1px solid var(--border)",
    color: header ? "var(--text)" : "var(--text-dim)",
    fontWeight: header ? 600 : 400,
    textAlign: "left",
    verticalAlign: "top",
  };
}
