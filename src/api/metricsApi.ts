import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface SystemMetrics {
  rpm: number;
  activeUsers: number;
  memoryUsage: number;
  cacheHitRate: number;
  rpmHistory: number[];
  predictedHistory: number[];
  redisOk: boolean;
  workerOk: boolean;
  aofOk: boolean;
  lastUpdated: number;
  predictedRPM?: number;
  avgLimit?: number;
  /** Flat [name, score, name, score, …] pairs, highest first. */
  topEngagedUsers?: string[];
  users?: { total: number; active: number; inactive: number };
  tenants?: { total: number; active: number; suspended: number };
  tables?: { name: string; rows: number; totalKB: number; usedKB: number }[];
  modules?: Record<"expenseBooking" | "purchaseOrders" | "workOrders", { status: string; count: number }[]>;
  server?: { uptimeSeconds: number; uptimeHours: number; nodeVersion: string; rssMemoryMB: number; heapUsedMB: number; environment: string };
}

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const res = await fetchWithAuth("/api/system/metrics");
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch system metrics");
  }
  return res.json().catch(() => ({}));
};
