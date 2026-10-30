import { useEffect, useState, type RefObject } from "react";

/**
 * The live width of an element. Legal layouts decide from the space they really have — the ERP's own
 * sidebars can leave a "large" screen with a narrow page, which screen-size breakpoints cannot see.
 */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
