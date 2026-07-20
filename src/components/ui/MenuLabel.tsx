/** Small uppercase section caption inside a dropdown menu ("Scratch pads", "Sort"). */
export function MenuLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "8px 12px 4px",
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "var(--text-dim)",
      }}
    >
      {children}
    </div>
  );
}
