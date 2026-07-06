import { useEffect, useState, type DependencyList, type RefObject } from "react";

/**
 * Track whether focus currently lives inside `ref`'s element. Uses
 * focusin/focusout with a rAF-deferred focusout read, so focus moving between
 * children of the element doesn't briefly flip the result to `false`. Pass
 * `deps` to re-bind the listeners when the underlying element identity changes.
 */
export function useFocusWithin(
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList = [],
): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onFocusIn = () => setFocused(true);
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        const root = ref.current;
        if (!root) return;
        setFocused(root.contains(document.activeElement));
      });
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    setFocused(el.contains(document.activeElement));
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, deps);
  return focused;
}
