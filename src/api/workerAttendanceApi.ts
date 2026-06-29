import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/worker-attendance";

async function handle<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON
  }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data as T;
}

export type AttendanceStatus = "P" | "A" | "H";

export interface WorkerSummary {
  id: number;
  name: string;
  skillType: string;
  companyName: string | null;
  projectId: number | null;
  projectName: string | null;
  activityId: number | null;
  activityName: string | null;
  presentCount: number;
  absentCount: number;
  halfDayCount: number;
}

export interface WorkerListResponse {
  data: WorkerSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AttendanceDay {
  id: number;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
  activityName: string | null;
  projectName: string | null;
}

export interface WorkerCalendarResponse {
  worker: { id: number; name: string; companyName: string | null };
  days: AttendanceDay[];
}

export interface MarkAttendancePayload {
  name: string;
  contractorId: number;
  skillType?: string;
  allocationId: number;
  date: string;
  status: AttendanceStatus;
  remarks?: string | null;
}

export const getWorkers = async (filters?: {
  companyId?: number;
  projectId?: number;
  contractorId?: number;
  activityId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<WorkerListResponse> => {
  const params = new URLSearchParams();
  if (filters?.companyId) params.set("companyId", String(filters.companyId));
  if (filters?.projectId) params.set("projectId", String(filters.projectId));
  if (filters?.contractorId) params.set("contractorId", String(filters.contractorId));
  if (filters?.activityId) params.set("activityId", String(filters.activityId));
  if (filters?.search) params.set("search", filters.search);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}/workers${qs}`);
  return handle<WorkerListResponse>(res);
};

export const getWorkerCalendar = async (
  workerId: number,
  month: string, // "YYYY-MM"
): Promise<WorkerCalendarResponse> => {
  const res = await fetchWithAuth(`${BASE}/workers/${workerId}/calendar?month=${month}`);
  return handle<WorkerCalendarResponse>(res);
};

export const markAttendance = async (
  payload: MarkAttendancePayload,
): Promise<{ success: boolean; workerId: number; attendanceId: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};
