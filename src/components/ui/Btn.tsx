import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant =
  | "ghost"
  | "solid"
  | "accent"
  | "primary"
  | "frame"
  | "gray-frame"
  | "danger";
type Size = "sm" | "md" | "lg";

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
};

export function Btn({
  variant = "ghost",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: BtnProps) {
  const classes = ["mc-btn", `mc-btn-${variant}`, `mc-btn-${size}`, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      className={classes}
    >
      <span className="mc-btn-content">
        {icon && <Icon name={icon} size={size === "sm" ? 11 : 13} />}
        {children}
      </span>
    </button>
  );
}
