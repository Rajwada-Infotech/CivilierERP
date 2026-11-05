// Notification-bell feed for the Civil Work DPR app, derived client-side from the activities list:
// work sent back for rework, and work that's on hold. Same shape as the other mobile apps' alert
// hooks, so TopHeader / NotificationsScreen stay identical to theirs.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivityAssignments } from "@/api/cwdApi";

export type CwdAlertType = "rework" | "hold" | "info";

export interface CwdAlert {
  id: string;
  type: CwdAlertType;
  title: string;
  subtitle: string;
  time?: string | null;
  route: string;
  params?: Record<string, unknown>;
}

export function useCwdAlerts() {
  // Only the activities that need attention, a handful each — the bell shows on every screen, so it must be cheap.
  const q = useQuery({
    queryKey: ["cwd-alerts"],
    queryFn: async () => {
      const [rework, hold] = await Promise.all([
        getActivityAssignments({ filter: "REWORK", limit: 15 }),
        getActivityAssignments({ filter: "HOLD", limit: 15 }),
      ]);
      return [...rework, ...hold];
    },
    staleTime: 120_000,
  });

  const alerts = useMemo<CwdAlert[]>(() => {
    const out: CwdAlert[] = [];
    for (const a of q.data ?? []) {
      const where = a.scopePath || a.projectName || "—";
      if (a.status === "REWORK") {
        out.push({
          id: `rework-${a.assignmentId}`,
          type: "rework",
          title: `Rework needed · ${a.activityName ?? "Activity"}`,
          subtitle: where,
          time: a.updatedAt,
          route: "Activities",
        });
      } else if (a.status === "HOLD") {
        out.push({
          id: `hold-${a.assignmentId}`,
          type: "hold",
          title: `On hold · ${a.activityName ?? "Activity"}`,
          subtitle: where,
          time: a.updatedAt,
          route: "Activities",
        });
      }
    }
    return out;
  }, [q.data]);

  return { alerts, isLoading: q.isLoading, refetch: q.refetch };
}
