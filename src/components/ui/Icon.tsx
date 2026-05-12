import type { CSSProperties } from "react";

export type IconName =
  | "plus"
  | "pin"
  | "pin-fill"
  | "search"
  | "grid"
  | "list"
  | "folder"
  | "terminal"
  | "chevron-right"
  | "chevron-down"
  | "chevron-left"
  | "maximize"
  | "minimize"
  | "x"
  | "more"
  | "check"
  | "archive"
  | "settings"
  | "git-branch"
  | "home"
  | "globe"
  | "play"
  | "upload"
  | "group"
  | "refresh"
  | "sparkles"
  | "copy"
  | "trash"
  | "github"
  | "chart"
  | "sun"
  | "moon"
  | "stop"
  | "external-link";

export function Icon({ name, size = 14, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
  };
  switch (name) {
    case "plus":
      return <svg {...common}><path d="M8 3v10M3 8h10" /></svg>;
    case "pin":
      return <svg {...common}><path d="M10 2l4 4-2 1-1 4-3-3-4 4 4-4-3-3 4-1 1-2z" /></svg>;
    case "pin-fill":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M10.5 1.8l3.7 3.7-1.9 1-1.1 3.9-2.8-2.8-4.2 4.2 4.2-4.2-2.8-2.8 3.9-1.1 1-1.9z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M13.5 13.5l-3-3" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" />
          <rect x="9" y="2" width="5" height="5" />
          <rect x="2" y="9" width="5" height="5" />
          <rect x="9" y="9" width="5" height="5" />
        </svg>
      );
    case "list":
      return <svg {...common}><path d="M2 4h12M2 8h12M2 12h12" /></svg>;
    case "folder":
      return (
        <svg {...common}>
          <path d="M2 4.5c0-.5.4-1 1-1h3l1.5 1.5H13c.5 0 1 .5 1 1V12c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1V4.5z" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <path d="M4 6l2 2-2 2M8 10h4" />
        </svg>
      );
    case "chevron-right":
      return <svg {...common}><path d="M6 3l5 5-5 5" /></svg>;
    case "chevron-down":
      return <svg {...common}><path d="M3 6l5 5 5-5" /></svg>;
    case "chevron-left":
      return <svg {...common}><path d="M10 3L5 8l5 5" /></svg>;
    case "maximize":
      return (
        <svg {...common}>
          <path d="M6 2H2v4M10 2h4v4M14 10v4h-4M2 10v4h4" />
          <path d="M5.5 5.5L2 2M10.5 5.5L14 2M10.5 10.5L14 14M5.5 10.5L2 14" />
        </svg>
      );
    case "minimize":
      return (
        <svg {...common}>
          <path d="M2 6h4V2M14 6h-4V2M10 14v-4h4M6 14v-4H2" />
          <path d="M6 2L2 6M10 2l4 4M14 10l-4 4M2 10l4 4" />
        </svg>
      );
    case "x":
      return <svg {...common}><path d="M3 3l10 10M13 3L3 13" /></svg>;
    case "more":
      return (
        <svg {...common}>
          <circle cx="3" cy="8" r="1" fill="currentColor" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
          <circle cx="13" cy="8" r="1" fill="currentColor" />
        </svg>
      );
    case "check":
      return <svg {...common}><path d="M3 8l3 3 7-7" /></svg>;
    case "archive":
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="13" height="3" />
          <path d="M3 6v7h10V6M6 9h4" />
        </svg>
      );
    case "settings":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
        >
          <path d="M9.67 2h4.66l.55 3.05c.43.18.83.41 1.2.69l2.91-1.04 2.33 4.04-2.36 2.01a7.7 7.7 0 010 1.5l2.36 2.01-2.33 4.04-2.91-1.04c-.37.28-.77.51-1.2.69L14.33 21H9.67l-.55-3.05a6.88 6.88 0 01-1.2-.69L5.01 18.3l-2.33-4.04 2.36-2.01a7.7 7.7 0 010-1.5L2.68 8.74 5.01 4.7l2.91 1.04c.37-.28.77-.51 1.2-.69L9.67 2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "git-branch":
      return (
        <svg {...common}>
          <circle cx="4" cy="3" r="1.5" />
          <circle cx="4" cy="13" r="1.5" />
          <circle cx="12" cy="6" r="1.5" />
          <path d="M4 4.5v7M4 9c0-2.5 2-3 4-3" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M2 7l6-5 6 5v6.5c0 .3-.2.5-.5.5H10V9H6v5H2.5c-.3 0-.5-.2-.5-.5V7z" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2.5 8h11M8 2c1.7 1.5 2.5 3.5 2.5 6S9.7 12.5 8 14M8 2C6.3 3.5 5.5 5.5 5.5 8S6.3 12.5 8 14" />
        </svg>
      );
    case "play":
      return <svg {...common}><path d="M4 3l9 5-9 5V3z" fill="currentColor" /></svg>;
    case "upload":
      return <svg {...common}><path d="M8 11V3M4 7l4-4 4 4M2 13h12" /></svg>;
    case "group":
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="5" height="5" />
          <rect x="9.5" y="3" width="5" height="5" />
          <rect x="5.5" y="9" width="5" height="5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M14 3v4h-4M2 13V9h4M13 7a5 5 0 00-9-2M3 9a5 5 0 009 2" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2L8 2zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L10.5 13l1.4-.6.6-1.4z" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="5" y="5" width="9" height="9" rx="1" />
          <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M2.5 4h11M6 4V2.5h4V4M3.5 4l.7 9.1c0 .5.4.9.9.9h5.8c.5 0 .9-.4.9-.9L12.5 4M6.5 7v4M9.5 7v4" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M2 13h12" />
          <rect x="3.5" y="8" width="2" height="5" />
          <rect x="7" y="5" width="2" height="8" />
          <rect x="10.5" y="2.5" width="2" height="10.5" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M13.5 10.1A5.6 5.6 0 015.9 2.5a5.8 5.8 0 107.6 7.6z" />
        </svg>
      );
    case "github":
      return (
        <svg {...common} viewBox="0 0 16 16" fill="currentColor" stroke="none">
          <path d="M8 .5a7.5 7.5 0 00-2.37 14.62c.37.07.5-.16.5-.36v-1.27c-2.08.45-2.52-1-2.52-1-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.14.77 1.14.77.67 1.14 1.75.81 2.18.62.07-.48.26-.81.47-1-1.66-.19-3.41-.83-3.41-3.7 0-.82.29-1.49.77-2.01-.08-.19-.33-.95.07-1.99 0 0 .63-.2 2.06.77a7.16 7.16 0 013.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.04.15 1.8.07 1.99.48.52.77 1.19.77 2.01 0 2.88-1.75 3.51-3.42 3.69.27.23.5.68.5 1.37v2.03c0 .2.13.43.5.36A7.5 7.5 0 008 .5z" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="4" y="4" width="8" height="8" rx="1" />
        </svg>
      );
    case "external-link":
      return (
        <svg {...common}>
          <path d="M9.5 2.5h4v4" />
          <path d="M13.5 2.5L7.5 8.5" />
          <path d="M12.5 9.5v3a1 1 0 01-1 1h-8a1 1 0 01-1-1v-8a1 1 0 011-1h3" />
        </svg>
      );
    default:
      return null;
  }
}
