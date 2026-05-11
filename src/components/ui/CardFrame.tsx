import { forwardRef, useCallback, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { useCardGlow } from "~/lib/use-card-glow";

type CardFrameProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "aside" | "nav" | "section";
  frame?: "square" | "slanted";
  glow?: boolean;
  focused?: boolean;
  solid?: boolean;
};

const FRAME_STYLES: Record<
  NonNullable<CardFrameProps["frame"]>,
  Pick<CSSProperties, "borderWidth" | "borderImageSource" | "borderImageSlice" | "borderImageWidth">
> = {
  square: {
    borderWidth: 16,
    borderImageSource: "url('/borders/square.png')",
    borderImageSlice: "48",
    borderImageWidth: "16px",
  },
  slanted: {
    borderWidth: 16,
    borderImageSource: "url('/borders/square.png')",
    borderImageSlice: "48",
    borderImageWidth: "16px",
  },
};

const frameBaseStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "rgba(3, 6, 8, 0.94)",
  backgroundClip: "padding-box",
  borderStyle: "solid",
  borderColor: "transparent",
  borderImageSlice: "180",
  borderImageRepeat: "stretch",
  overflow: "hidden",
  position: "relative",
};

export const CardFrame = forwardRef<HTMLElement, CardFrameProps>(function CardFrame(
  { as: Component = "div", frame = "square", glow = false, focused = false, solid = false, style, ...props },
  forwardedRef
) {
  const glowRef = useCardGlow<HTMLElement>();
  const frameStyle = FRAME_STYLES[frame];
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      glowRef(glow ? node : null);
      assignRef(forwardedRef, node);
    },
    [forwardedRef, glow, glowRef]
  );

  return (
    <Component
      {...props}
      ref={setRef}
      style={{
        ...frameBaseStyle,
        ...frameStyle,
        ...style,
        background:
          style?.background ??
          `linear-gradient(${solid ? "rgba(3, 6, 8, 0.15)" : "rgba(3, 6, 8, 0.10)"}, ${solid ? "rgba(3, 6, 8, 0.15)" : "rgba(3, 6, 8, 0.10)"}), url('/borders/square.png') 39.0625% 39.0625% / 200% 200% no-repeat`,
        borderStyle: "solid",
        borderColor: "transparent",
        borderWidth: frameStyle.borderWidth,
        borderImageSource: focused ? "var(--mc-panel-focused-image)" : frameStyle.borderImageSource,
        borderImageSlice: frameStyle.borderImageSlice,
        borderImageWidth: frameStyle.borderImageWidth,
        borderImageRepeat: "stretch",
      }}
    />
  );
});

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
}
