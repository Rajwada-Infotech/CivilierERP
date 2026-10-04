// Notification-bell feed, derived client-side from the list endpoints:
// overdue quality-check follow-ups + unposted Draft maintenance vouchers.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQualityChecks, getMaintenanceList } from "@/api/fixedAssetApi";

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
  const qcQ = useQuery({ queryKey: ["fa-quality"], queryFn: () => getQualityChecks(), staleTime: 60_000 });
  const maintQ = useQuery({ queryKey: ["fa-maint"], queryFn: () => getMaintenanceList(), staleTime: 60_000 });

  const alerts = useMemo<FaAlert[]>(() => {
    const out: FaAlert[] = [];
    for (const q of qcQ.data ?? []) {
      if (q.FollowUpStatus === "Pending" && q.IsOverdue === 1) {
        out.push({
          id: `qc-${q.QualityCheckId}`,
          type: "followup_due",
          title: `Overdue follow-up · ${q.FAItemCode ?? q.ItemName ?? "asset"}`,
          subtitle: `${q.FollowUpType || "Follow-up"} was due ${q.NextFollowUpDate ? new Date(q.NextFollowUpDate).toLocaleDateString("en-IN") : ""}`,
          time: q.NextFollowUpDate,
          route: "QualityCheckDetail",
          params: { id: q.QualityCheckId },
        });
      }
    }
    for (const m of maintQ.data ?? []) {
      if (m.Status === "Draft") {
        out.push({
          id: `fm-${m.MaintenanceId}`,
          type: "draft_pending",
          title: `Draft repair not posted · ${m.DocNo}`,
          subtitle: `${m.ItemName ?? "—"} · ${m.VendorName ?? "—"}`,
          time: m.CreatedAt,
          route: "MaintenanceDetail",
          params: { id: m.MaintenanceId },
        });
      }
    }
    return out.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  }, [qcQ.data, maintQ.data]);

  return {
    alerts,
    isLoading: qcQ.isLoading || maintQ.isLoading,
    refetch: async () => { await Promise.all([qcQ.refetch(), maintQ.refetch()]); },
  };
}
