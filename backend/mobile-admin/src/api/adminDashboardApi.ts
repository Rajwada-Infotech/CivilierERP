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
