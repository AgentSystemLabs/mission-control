import type { CSSProperties } from "react";
import { SiOpenai } from "react-icons/si";
import type { TaskAgent } from "~/shared/domain";

/**
 * Brand mark for an agent. Claude and Cursor render from PNG assets in
 * public/ (the brand-accurate marks ship with the app); Codex falls back to
 * the OpenAI mark from react-icons; Shell uses a tiny prompt glyph.
 *
 * Pass `tinted={false}` for surfaces that want the PNG to render at full
 * fidelity instead of as a low-opacity watermark.
 */
export function AgentLogo({
  agent,
  size = 14,
  style,
  title,
}: {
  agent: TaskAgent;
  size?: number;
  style?: CSSProperties;
  title?: string;
}) {
  if (agent === "claude-code") {
    return <PngLogo src="/claude.png" alt={title ?? "Claude"} size={size} style={style} />;
  }
  if (agent === "cursor-cli") {
    return <PngLogo src="/cursor.png" alt={title ?? "Cursor"} size={size} style={style} />;
  }
  if (agent === "codex") {
    return <SiOpenai size={size} style={style} title={title} />;
  }
  if (agent === "opencode") {
    return <PngLogo src="/opencode.svg" alt={title ?? "OpenCode"} size={size} style={style} />;
  }
  return <ShellMark size={size} style={style} title={title} />;
}

function PngLogo({
  src,
  alt,
  size,
  style,
}: {
  src: string;
  alt: string;
  size: number;
  style?: CSSProperties;
}) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        display: "block",
        width: size,
        height: size,
        objectFit: "contain",
        ...style,
      }}
    />
  );
}

function ShellMark({
  size,
  style,
  title,
}: {
  size: number;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M3 4l3.5 3-3.5 3M8.5 11h5" />
    </svg>
  );
}
