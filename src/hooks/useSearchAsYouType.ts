import { useEffect, useRef } from "react";

/**
 * Runs a list search shortly after the user stops typing, so a search box
 * works without pressing Enter (Enter can still apply it at once). `apply`
 * gets the trimmed text; it is called only when the text actually changed,
 * so a page isn't reset back to page 1 for nothing.
 */
export function useSearchAsYouType(value: string, apply: (v: string) => void, delayMs = 400) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const last = useRef(value.trim());
  useEffect(() => {
    const v = value.trim();
    if (v === last.current) return;
    const t = setTimeout(() => {
      last.current = v;
      applyRef.current(v);
    }, delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
}
