import { useLayoutEffect, useState, type RefObject } from "react";

// Shared controls (dropdowns, pickers) are used on pages that are on the drawing sheet and on pages that are not.
// This tells a control which it is on, so it can draw itself to match: squared and inked on a sheet, as before elsewhere.
export function useInSheet(ref: RefObject<HTMLElement | null>): boolean {
  const [inSheet, setInSheet] = useState(false);
  useLayoutEffect(() => {
    setInSheet(!!ref.current?.closest(".sheet-frame, .crm-sheet"));
  }, [ref]);
  return inSheet;
}
