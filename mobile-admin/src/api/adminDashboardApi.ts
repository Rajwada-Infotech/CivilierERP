// Thin client for GET /api/admin-dashboard (backend/routes/adminDashboard.js)
// — total/active users, total roles, and the 5 most-recently-created users.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface AdminDashboardUser {
  id: number;
  name: string;
  email: string;
  created_datetime: string;
  discontinue: number;
}

export interface AdminDashboardData {
  stats: {
    totalUsers: number;
    totalRoles: number;
    activeUsers: number;
  };
  recentUsers: AdminDashboardUser[];
  timestamp: string;
}

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  const res = await fetchWithAuth("/api/admin-dashboard");
  if (!res.ok) throw new Error("Failed to fetch admin dashboard");
  const json = await res.json();
  return { stats: json.stats, recentUsers: json.recentUsers ?? [], timestamp: json.timestamp };
}

// GET /api/user-activity — the activity log, newest first (the web dashboard's "Latest activity" reads the first 6).
export interface ActivityRow {
  id: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: string;
  actionType: string;
  resource: string;
  details: string;
  timestamp: string;
}

export async function fetchRecentActivity(limit = 6): Promise<{ data: ActivityRow[]; total: number }> {
  const res = await fetchWithAuth(`/api/user-activity?limit=${limit}&page=1`, { skipActivityLog: true });
  if (!res.ok) throw new Error("Failed to fetch the activity log");
  const json = await res.json().catch(() => ({}));
  return { data: Array.isArray(json?.data) ? json.data : [], total: Number(json?.total) || 0 };
}
