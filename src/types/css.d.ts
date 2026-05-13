import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--mc-${string}`]: string | number | undefined;
    WebkitAppRegion?: "drag" | "no-drag";
  }
}
