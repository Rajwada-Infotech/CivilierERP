// What the header's bell counts and the Notifications page lists, for the signed-in person's interface:
//   resident  visitors waiting at the gate for one of their flats (tap: approve or deny)
//   guard     answers to their requests (approved / denied / no response) since they last opened Notifications
//   admin     alerts nobody has acknowledged (left the zone, device offline, request unanswered)
// plus complaints about guards: residents see each status change on theirs since they last looked; admins see the
// complaints still open. And "earlier": what was settled recently (last visitors, acknowledged alerts).
// The guard's list shares the home page's read, so the two never disagree.
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { useSecurityView } from "@/navigation/securityRole";
import { fetchSecurityDashboard, type VisitorRow } from "@/api/securityDashboardApi";
import { getPendingForMe } from "@/api/visitorsApi";
import { useSocketEvent, useVisitorEvents } from "@/visitors/useSecuritySocket";
import { allComplaints, myComplaints, type Complaint } from "@/api/securityMoreApi";
import { useNotificationsSeenAt } from "./seenStore";

export interface OpenAlert {
  id: number;
  type: "LEFT_ZONE" | "DEVICE_OFFLINE" | "UNANSWERED";
  detail: string | null;
  at: string;
  escalatedAt: string | null;
  guardName: string | null;
  projectName: string;
  requestId: number | null;
}

export type PastAlert = OpenAlert & { acknowledgedAt: string | null; acknowledgedBy: string | null };

async function openAlerts(): Promise<OpenAlert[]> {
  return alertList(true);
}
async function alertList(openOnly: boolean): Promise<PastAlert[]> {
  try {
    const res = await fetchWithAuth(`/api/security/alerts${openOnly ? "?open=1" : ""}`);
    return res.ok ? await res.json() : [];
  } catch {
    return []; // no Security Live right: no alerts in the bell
  }
}

export function useSecurityNotifications() {
  const { view } = useSecurityView();
  const resident = useQuery({ queryKey: ["security-pending-mine"], queryFn: getPendingForMe, enabled: view === "customer", refetchInterval: 15000 });
  const residentDash = useQuery({ queryKey: ["security-dashboard", "customer", null], queryFn: () => fetchSecurityDashboard("customer"), enabled: view === "customer" });
  const allAlerts = useQuery({ queryKey: ["security-all-alerts"], queryFn: () => alertList(false), enabled: view === "admin", refetchInterval: 60000 });
  const guard = useQuery({
    queryKey: ["security-dashboard", "guard", null],
    queryFn: () => fetchSecurityDashboard("guard"),
    enabled: view === "guard",
    refetchInterval: 15000,
  });
  const alerts = useQuery({ queryKey: ["security-open-alerts"], queryFn: openAlerts, enabled: view === "admin", refetchInterval: 20000 });
  const residentComplaints = useQuery({ queryKey: ["security-my-complaints"], queryFn: myComplaints, enabled: view === "customer", refetchInterval: 120000 });
  // Without the Security Live right the list is refused: then no complaints in the bell.
  const openComplaints = useQuery({
    queryKey: ["security-open-complaints"],
    queryFn: () => allComplaints("OPEN").catch(() => [] as Complaint[]),
    enabled: view === "admin",
    refetchInterval: 60000,
  });
  useSocketEvent("security:complaint", view === "customer" || view === "admin", () => {
    if (view === "customer") void residentComplaints.refetch();
    else void openComplaints.refetch();
  });

  // The bell's count changes the moment a request is raised, escalated or settled.
  useVisitorEvents(view === "customer" || view === "guard", () => {
    if (view === "customer") void resident.refetch();
    else void guard.refetch();
  });

  const seenAt = useNotificationsSeenAt();
  // Residents: visitors waiting for them. Guards: the answers they haven't seen yet (their own waiting requests are on
  // the home page, not news).
  const guardAnswers = (guard.data?.recent ?? []).filter((r) => r.status !== "PENDING" && new Date(r.decidedAt ?? r.requestedAt).getTime() > seenAt);
  const visitors: VisitorRow[] = view === "customer" ? resident.data ?? [] : view === "guard" ? guardAnswers : [];
  const open: OpenAlert[] = view === "admin" ? alerts.data ?? [] : [];
  const loading = (view === "customer" && resident.isLoading) || (view === "guard" && guard.isLoading) || (view === "admin" && alerts.isLoading);
  const recent: VisitorRow[] = view === "customer" ? residentDash.data?.recent ?? [] : view === "guard" ? guard.data?.recent ?? [] : [];
  const earlierVisitors = recent.filter((r) => r.status !== "PENDING" && !visitors.some((v) => v.id === r.id)).slice(0, 15);
  const earlierAlerts = view === "admin" ? (allAlerts.data ?? []).filter((a) => a.acknowledgedAt).slice(0, 15) : [];
  // Residents: complaints the security team moved on since they last opened Notifications. Admins: the open ones.
  const complaintUpdates: Complaint[] =
    view === "customer"
      ? (residentComplaints.data ?? []).filter((c) => c.handledAt && new Date(c.handledAt).getTime() > seenAt)
      : view === "admin"
        ? openComplaints.data ?? []
        : [];
  const earlierComplaints: Complaint[] =
    view === "customer" ? (residentComplaints.data ?? []).filter((c) => c.handledAt && !complaintUpdates.some((u) => u.id === c.id)).slice(0, 10) : [];
  // Only this interface's reads: refetch() runs even a disabled query, and a staff route called with a resident's
  // portal token answers 401, which signs the person out.
  const refetch = () =>
    Promise.all(
      view === "customer"
        ? [resident.refetch(), residentDash.refetch(), residentComplaints.refetch()]
        : view === "guard"
          ? [guard.refetch()]
          : view === "admin"
            ? [alerts.refetch(), allAlerts.refetch(), openComplaints.refetch()]
            : [],
    );
  return {
    view,
    visitors,
    alerts: open,
    complaints: complaintUpdates,
    earlierVisitors,
    earlierAlerts,
    earlierComplaints,
    count: visitors.length + open.length + complaintUpdates.length,
    loading,
    refetch,
  };
}
