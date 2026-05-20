import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Ctx = {
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
};

const HeaderActionsCtx = createContext<Ctx>({
  target: null,
  setTarget: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <HeaderActionsCtx.Provider value={{ target, setTarget }}>
      {children}
    </HeaderActionsCtx.Provider>
  );
}

export function HeaderActionsSlot({ style }: { style?: React.CSSProperties }) {
  const { setTarget } = useContext(HeaderActionsCtx);
  return (
    <div
      ref={setTarget}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        ["WebkitAppRegion" as any]: "no-drag",
        ...style,
      }}
    />
  );
}

export function HeaderActions({ children }: { children: ReactNode }) {
  const { target } = useContext(HeaderActionsCtx);
  if (!target) return null;
  return createPortal(children, target);
}
