import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type DropdownMenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  icon?: IconName;
  leading?: ReactNode;
  danger?: boolean;
  children: ReactNode;
};

export function DropdownMenuItem({
  icon,
  leading,
  danger = false,
  children,
  className,
  ...rest
}: DropdownMenuItemProps) {
  const start =
    leading ??
    (icon ? (
      <span className="mc-dropdown-menu-item-icon" aria-hidden>
        <Icon name={icon} size={12} />
      </span>
    ) : null);

  return (
    <button
      type="button"
      role="menuitem"
      className={[
        "mc-dropdown-menu-item",
        danger ? "mc-dropdown-menu-item-danger" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {start}
      <span className="mc-dropdown-menu-item-label">{children}</span>
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="mc-dropdown-menu-separator" />;
}
