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
  Pick<CSSProperties, "borderWidth" | "borderImageSlice" | "borderImageWidth">
> = {
  square: {
    borderWidth: 16,
    borderImageSlice: "48",
    borderImageWidth: "16px",
  },
  slanted: {
    borderWidth: 16,
    borderImageSlice: "48",
    borderImageWidth: "16px",
  },
};

const frameBaseStyle: CSSProperties = {
  boxSizing: "border-box",
  borderStyle: "solid",
  borderColor: "transparent",
  overflow: "hidden",
  position: "relative",
};

type FrameStyle = CSSProperties & Record<`--${string}`, string | number>;

export const CardFrame = forwardRef<HTMLElement, CardFrameProps>(function CardFrame(
  {
    as: Component = "div",
    frame = "square",
    glow = false,
    focused = false,
    solid = false,
    className,
    style,
    children,
    ...props
  },
  forwardedRef
) {
  const glowRef = useCardGlow<HTMLElement>();
  const frameStyle = FRAME_STYLES[frame];
  const {
    background,
    backgroundClip,
    backgroundImage,
    backgroundPosition,
    backgroundRepeat,
    backgroundSize,
    ...restStyle
  } = style ?? {};
  const hasCustomBackground = background != null || backgroundImage != null;
  const frameImage = focused ? "var(--mc-panel-focused-image)" : "var(--mc-panel-image)";
  const frameClassName = ["mc-card-frame", className ?? ""].filter(Boolean).join(" ");
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
      className={frameClassName}
      style={{
        ...frameBaseStyle,
        ...frameStyle,
        ...restStyle,
        "--mc-card-frame-bg-color": hasCustomBackground ? "transparent" : "rgba(3, 6, 8, 0.94)",
        "--mc-card-frame-bg-image": hasCustomBackground
          ? "none"
          : `linear-gradient(${solid ? "rgba(3, 6, 8, 0.15)" : "rgba(3, 6, 8, 0.10)"}, ${
              solid ? "rgba(3, 6, 8, 0.15)" : "rgba(3, 6, 8, 0.10)"
            }), ${frameImage}`,
        "--mc-card-frame-bg-position": hasCustomBackground ? "0 0" : "0 0, 39.0625% 39.0625%",
        "--mc-card-frame-bg-repeat": hasCustomBackground ? "repeat" : "repeat, no-repeat",
        "--mc-card-frame-bg-size": hasCustomBackground ? "auto" : "auto, 200% 200%",
        "--mc-card-frame-border-image": frameImage,
        "--mc-card-frame-border-width": frameStyle.borderImageWidth,
        "--mc-card-frame-border-slice": frameStyle.borderImageSlice,
        ...(hasCustomBackground
          ? {
              background,
              backgroundClip,
              backgroundImage,
              backgroundPosition,
              backgroundRepeat,
              backgroundSize,
            }
          : {
              background: "transparent",
            }),
        borderStyle: "solid",
        borderColor: "transparent",
        borderWidth: frameStyle.borderWidth,
      } as FrameStyle}
    >
      <span aria-hidden className="mc-card-frame-layer" />
      {children}
    </Component>
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
