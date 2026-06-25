import { useEffect, useRef } from "react";

export function useInspectorAutoCollapse(
  setInspectorOpen: (open: boolean) => void,
  narrowBreakpoint = 899,
) {
  const setInspectorOpenRef = useRef(setInspectorOpen);
  setInspectorOpenRef.current = setInspectorOpen;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(`(max-width: ${narrowBreakpoint}px)`);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setInspectorOpenRef.current(false);
      }
    };

    if (mql.matches) {
      setInspectorOpenRef.current(false);
    }

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [narrowBreakpoint]);
}
