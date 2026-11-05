import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { moduleOfPath } from "@/lib/moduleOfPath";
import { recordModuleVisit } from "@/api/homeWidgetsApi";

// One visit per module per minute — moving between pages inside a module is
// one stretch of work, not dozens of visits.
const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

// Records which module the user is working in, for the Home page's
// personalised widgets. Fire-and-forget: tracking must never get in the way.
export function useModuleUsageTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    const module = moduleOfPath(pathname);
    if (!module) return;
    const now = Date.now();
    if (now - (lastSent.get(module) ?? 0) < THROTTLE_MS) return;
    lastSent.set(module, now);
    recordModuleVisit(module).catch(() => {});
  }, [pathname]);
}
