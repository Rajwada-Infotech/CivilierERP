// Client-derived alert list for the Fixed Asset app's notification bell.
// Stub for now — the web module has no dedicated notifications endpoint;
// alerts (e.g. quality-check follow-ups due, draft maintenance not posted)
// can be derived here from the existing list endpoints once those screens
// exist. Returns an empty list so the bell renders with no badge.
import { useMemo } from "react";

export type FaAlertType = "followup_due" | "draft_pending" | "info";

export interface FaAlert {
  id: string;
  type: FaAlertType;
  title: string;
  subtitle: string;
  time?: string | null;
  route: string;
  params?: Record<string, unknown>;
}

export function useFaAlerts() {
  const alerts = useMemo<FaAlert[]>(() => [], []);
  return { alerts, isLoading: false, refetch: async () => {} };
}
