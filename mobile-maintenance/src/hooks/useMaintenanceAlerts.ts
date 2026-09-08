// Notification-bell feed, derived client-side from the list endpoints:
// meters whose reading is overdue + electricity personnel who haven't
// checked in yet today. Same shape as the other mobile apps' own alert
// hooks (e.g. mobile-Fixed-Asset's useFaAlerts) so TopHeader/
// NotificationsScreen can stay identical.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMeters } from "@/api/electricityMaintenanceApi";
import { getSecurityPersonnel, getSecurityAttendance } from "@/api/securityAttendanceApi";

export type MaintenanceAlertType = "reading_due" | "not_checked_in" | "info";

export interface MaintenanceAlert {
  id: string;
  type: MaintenanceAlertType;
  title: string;
  subtitle: string;
  time?: string | null;
  route: string;
  params?: Record<string, unknown>;
}

const today = () => new Date().toISOString().slice(0, 10);

export function useMaintenanceAlerts() {
  const metersQ = useQuery({ queryKey: ["mnt-meters"], queryFn: () => getMeters(), staleTime: 60_000 });
  const personnelQ = useQuery({ queryKey: ["mnt-personnel"], queryFn: () => getSecurityPersonnel(), staleTime: 60_000 });
  const attendanceQ = useQuery({ queryKey: ["mnt-attendance-today"], queryFn: () => getSecurityAttendance({ date: today() }), staleTime: 60_000 });

  const alerts = useMemo<MaintenanceAlert[]>(() => {
    const out: MaintenanceAlert[] = [];

    for (const m of metersQ.data ?? []) {
      if (m.Status === "Active" && m.LatestBillStatus === null && !m.LatestUnitsConsumed) {
        out.push({
          id: `meter-${m.Id}`,
          type: "reading_due",
          title: `Reading pending · ${m.MeterNumber}`,
          subtitle: `${m.CustomerName ?? "—"} · ${[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}`,
          route: "MeterDetail",
          params: { id: m.Id },
        });
      }
    }

    const checkedInIds = new Set((attendanceQ.data ?? []).map((a) => a.SecurityId));
    for (const p of personnelQ.data ?? []) {
      if (p.Status === "Active" && !checkedInIds.has(p.Id)) {
        out.push({
          id: `person-${p.Id}`,
          type: "not_checked_in",
          title: `Not checked in yet · ${p.Name}`,
          subtitle: `${p.SecurityCode} · ${p.DefaultShiftName ?? "no default shift"}`,
          route: "Attendance",
        });
      }
    }

    return out;
  }, [metersQ.data, personnelQ.data, attendanceQ.data]);

  return {
    alerts,
    isLoading: metersQ.isLoading || personnelQ.isLoading || attendanceQ.isLoading,
    refetch: async () => { await Promise.all([metersQ.refetch(), personnelQ.refetch(), attendanceQ.refetch()]); },
  };
}
