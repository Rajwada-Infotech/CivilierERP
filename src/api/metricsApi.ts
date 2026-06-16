import api from "./axios";

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
  topEngagedUsers?: string[];
}

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const res = await api.get<SystemMetrics>("/system/metrics");
  return res.data;
};

/**
 * Fetches metrics from an arbitrary base URL with an optional token.
 * Used by the admin monitor panel which can point at a different server.
 * Intentionally keeps raw fetch — the configured axios instance is locked
 * to this app's base URL and cannot be retargeted at runtime.
 */
export const fetchMetrics = async (
  baseURL: string,
  token?: string,
): Promise<SystemMetrics> => {
  const url = `${baseURL.replace(/\/$/, "")}/api/system/metrics`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timeout (8s)");
    }
    throw error;
  }
};

export const getDemoMetrics = () => {
  if (!import.meta.env.DEV) {
    throw new Error("Demo metrics are available only in development");
  }
  return {
    rpm: 42 + Math.floor(Math.random() * 20),
    activeUsers: 3 + Math.floor(Math.random() * 5),
    memoryUsage: 0.23 + Math.random() * 0.1,
    cacheHitRate: 0.72 + (Math.random() - 0.5) * 0.1,
    rpmHistory: Array.from({ length: 12 }, (_, i) => 30 + i * 2 + Math.random() * 10),
    predictedHistory: Array.from({ length: 12 }, (_, i) => 35 + i * 2.3 + Math.random() * 8),
    redisOk: true,
    workerOk: true,
    aofOk: true,
    lastUpdated: Date.now(),
  };
};