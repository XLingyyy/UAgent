import { useEffect, useState } from "react";
export const DRAWER_BREAKPOINT = 1120;
export function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= DRAWER_BREAKPOINT);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= DRAWER_BREAKPOINT);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return narrow;
}
