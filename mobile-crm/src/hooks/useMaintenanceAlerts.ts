// Notification-bell feed, derived client-side from the list endpoints:
// meters whose reading is overdue + electricity personnel who haven't
// checked in yet today. Same shape as the other mobile apps' own alert
// hooks (e.g. mobile-Fixed-Asset's useFaAlerts) so TopHeader/
// NotificationsScreen can stay identical.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMeters } from "@/api/electricityMaintenanceApi";
import { getSecurityPersonnel, getSecurityAttendance } from "@/api/securityAttendanceApi";
import { useAuth } from "@/auth/AuthContext";

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
  // Each feed only for staff with a right on its page (the web's Maintenance menu keys).
  const { canAccessPage } = useAuth();
  const meters = canAccessPage("maintenance-electricity");
  const security = canAccessPage("maintenance-security-attendance");
  const metersQ = useQuery({ queryKey: ["mnt-meters"], queryFn: () => getMeters(), staleTime: 60_000, enabled: meters });
  const personnelQ = useQuery({ queryKey: ["mnt-personnel"], queryFn: () => getSecurityPersonnel(), staleTime: 60_000, enabled: security });
  const attendanceQ = useQuery({ queryKey: ["mnt-attendance-today"], queryFn: () => getSecurityAttendance({ date: today() }), staleTime: 60_000, enabled: security });

  const alerts = useMemo<MaintenanceAlert[]>(() => {
    const out: MaintenanceAlert[] = [];

    for (const m of metersQ.data ?? []) {
      if (m.Status === "Active" && m.LatestBillStatus === null && !m.LatestUnitsConsumed) {
        out.push({
          id: `meter-${m.Id}`,
          type: "reading_due",
          title: `Reading pending · ${m.MeterNumber}`,
          subtitle: `${m.CustomerName ?? "—"} · ${[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}`,
          route: "Electricity",
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
    isLoading: (meters && metersQ.isLoading) || (security && (personnelQ.isLoading || attendanceQ.isLoading)),
    refetch: async () => { await Promise.all([meters && metersQ.refetch(), security && personnelQ.refetch(), security && attendanceQ.refetch()]); },
  };
}
