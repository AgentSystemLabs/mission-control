import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

type NavItem = { to: string; label: string; icon: IconName };

function SettingsLayout() {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(!!getElectron());
  }, []);

  const items: NavItem[] = [
    { to: "/settings/general", label: "General", icon: "settings" },
    { to: "/settings/api", label: "External API", icon: "terminal" },
    { to: "/settings/keybindings", label: "Keybindings", icon: "settings" },
    ...(isElectron
      ? ([{ to: "/settings/storage", label: "Storage", icon: "folder" }] as NavItem[])
      : []),
  ];

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }} className="dot-grid-bg">
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "28px 12px",
          background: "var(--surface-0)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
            padding: "0 10px 12px",
          }}
        >
          Settings
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((item) => (
            <SettingsNavLink key={item.to} {...item} />
          ))}
        </nav>
      </aside>
      <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function SettingsNavLink({ to, label, icon }: NavItem) {
  return (
    <Link
      to={to}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 7,
        fontFamily: "var(--mono)",
        fontSize: 12,
        textDecoration: "none",
        color: "var(--text-dim)",
        border: "1px solid transparent",
      }}
      activeProps={{
        style: {
          color: "var(--text)",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
        },
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </Link>
  );
}
