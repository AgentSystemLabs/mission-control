import type { CSSProperties } from "react";
import { SiOpenai } from "react-icons/si";
import type { TaskAgent } from "~/shared/domain";

/**
 * Brand mark for an agent. Claude, Cursor, and OpenCode render from public
 * assets; Codex uses the OpenAI mark; Grok and Shell use compact vector marks.
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
  if (agent === "grok") {
    return <GrokMark size={size} style={style} title={title ?? "Grok Build"} />;
  }
  if (agent === "opencode") {
    return <PngLogo src="/opencode.svg" alt={title ?? "OpenCode"} size={size} style={style} />;
  }
  return <ShellMark size={size} style={style} title={title} />;
}

function GrokMark({
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
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M11.7 4.3a5.25 5.25 0 1 0 0 7.4" />
      <path d="M3.1 12.9 12.9 3.1" />
    </svg>
  );
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
