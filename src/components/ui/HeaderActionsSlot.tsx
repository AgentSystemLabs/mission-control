import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Ctx = {
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
  beforeSearchTarget: HTMLElement | null;
  setBeforeSearchTarget: (el: HTMLElement | null) => void;
};

const HeaderActionsCtx = createContext<Ctx>({
  target: null,
  setTarget: () => {},
  beforeSearchTarget: null,
  setBeforeSearchTarget: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [beforeSearchTarget, setBeforeSearchTarget] = useState<HTMLElement | null>(null);
  return (
    <HeaderActionsCtx.Provider
      value={{ target, setTarget, beforeSearchTarget, setBeforeSearchTarget }}
    >
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

/** Slot in the TopBar immediately left of prompt/session search. */
export function HeaderBeforeSearchSlot({ style }: { style?: React.CSSProperties }) {
  const { setBeforeSearchTarget } = useContext(HeaderActionsCtx);
  return (
    <div
      ref={setBeforeSearchTarget}
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

/** Portal project-route actions into {@link HeaderBeforeSearchSlot}. */
export function HeaderBeforeSearch({ children }: { children: ReactNode }) {
  const { beforeSearchTarget } = useContext(HeaderActionsCtx);
  if (!beforeSearchTarget) return null;
  return createPortal(children, beforeSearchTarget);
}
