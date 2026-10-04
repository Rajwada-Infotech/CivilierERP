import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isDocFinderShortcut, isEditableTarget } from "@/hooks/useGlobalShortcuts";
import { DocFinderDialog } from "./DocFinderDialog";
import { DocFinderContext, type DocFinderContextValue } from "./useDocFinder";
import type { DocSearchResult } from "./docFinderApi";

/**
 * Mounted once in AppLayout (beside CompassProvider) so Alt+Shift+D works from
 * every module. Picking a result navigates to that document's list page with
 * `?view=<id>`; the page opens its own existing detail modal.
 */
export function DocFinderProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const openDocFinder = useCallback(() => setOpen(true), []);
  const closeDocFinder = useCallback(() => setOpen(false), []);

  const openResult = useCallback(
    (r: DocSearchResult) => {
      setOpen(false);
      navigate(r.url);
    },
    [navigate],
  );

  // Capture phase so a focused non-text control can't swallow it; backs off
  // while typing in a field or dropdown, where the keystroke belongs to the user.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      if (!isDocFinderShortcut(e) || isEditableTarget(e.target)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Browser back/forward while open shouldn't leave it hanging.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const value = useMemo<DocFinderContextValue>(
    () => ({ open, openDocFinder, closeDocFinder, openResult }),
    [open, openDocFinder, closeDocFinder, openResult],
  );

  return (
    <DocFinderContext.Provider value={value}>
      {children}
      <DocFinderDialog />
    </DocFinderContext.Provider>
  );
}
