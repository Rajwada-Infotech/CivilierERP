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

export interface ActivityOption {
  rungId: number;
  sequenceNo: number;
  activityName: string;
  dependencyMasterId: number;
  alias: string;
  projectId: number;
  towerName: string | null;
  floor: string | null;
  flatName: string | null;
  roomName: string | null;
  label: string;
  rosterCount: number;
}

export interface WorkerSearchResult {
  id: number;
  name: string;
  skillType: string;
  aadhaarNo: string | null;
  contractorName: string | null;
}

export interface RosterWorker {
  id: number;
  name: string;
  skillType: string;
  contractorName: string | null;
}

export interface AttendanceRow {
  workerId: number;
  workerName: string;
  skillType: string;
  contractorName: string | null;
  attendanceId: number | null;
  status: AttendanceStatus | null;
  remarks: string | null;
}

export interface AttendanceReportRow {
  id: number;
  date: string;
  status: AttendanceStatus;
  workerId: number;
  workerName: string;
  contractorName: string | null;
  activityId: number;
  activityName: string;
  dependencyAlias: string;
  activityLabel: string;
  projectId: number | null;
  projectName: string | null;
  companyId: number | null;
  companyName: string | null;
}

export interface AttendanceDay {
  id: number;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
  activityLabel: string | null;
  projectName: string | null;
}

export interface WorkerCalendarResponse {
  worker: { id: number; name: string; companyName: string | null };
  days: AttendanceDay[];
}

export const getActivitiesForProject = async (projectId: number): Promise<ActivityOption[]> => {
  const res = await fetchWithAuth(`${BASE}/activities?projectId=${projectId}`);
  return handle<ActivityOption[]>(res);
};

export const searchWorkers = async (filters?: { search?: string; contractorId?: number }): Promise<WorkerSearchResult[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.contractorId) params.set("contractorId", String(filters.contractorId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}/workers${qs}`);
  return handle<WorkerSearchResult[]>(res);
};

export const createWorker = async (payload: { name: string; contractorId: number; skillType?: string; aadhaarNo: string }): Promise<{ id: number; existed: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/workers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const getRoster = async (rungId: number): Promise<RosterWorker[]> => {
  const res = await fetchWithAuth(`${BASE}/roster/${rungId}`);
  return handle<RosterWorker[]>(res);
};

export const addToRoster = async (rungId: number, workerIds: number[]): Promise<{ success: boolean; added: number }> => {
  const res = await fetchWithAuth(`${BASE}/roster/${rungId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerIds }),
  });
  return handle(res);
};

export const removeFromRoster = async (rungId: number, workerId: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/roster/${rungId}/${workerId}`, { method: "DELETE" });
  return handle(res);
};

export const getAttendance = async (rungId: number, date: string): Promise<AttendanceRow[]> => {
  const res = await fetchWithAuth(`${BASE}/attendance?rungId=${rungId}&date=${date}`);
  return handle<AttendanceRow[]>(res);
};

export const saveAttendance = async (payload: {
  rungId: number;
  date: string;
  entries: { workerId: number; status: AttendanceStatus; remarks?: string | null }[];
}): Promise<{ success: boolean; saved: number }> => {
  const res = await fetchWithAuth(`${BASE}/attendance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const getAttendanceReport = async (filters?: {
  companyId?: number;
  projectId?: number;
  activityId?: number;
  workerId?: number;
  status?: AttendanceStatus;
  dateFrom?: string;
  dateTo?: string;
}): Promise<AttendanceReportRow[]> => {
  const params = new URLSearchParams();
  if (filters?.companyId) params.set("companyId", String(filters.companyId));
  if (filters?.projectId) params.set("projectId", String(filters.projectId));
  if (filters?.activityId) params.set("activityId", String(filters.activityId));
  if (filters?.workerId) params.set("workerId", String(filters.workerId));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}/report${qs}`);
  return handle<AttendanceReportRow[]>(res);
};

export const getWorkerCalendar = async (
  workerId: number,
  month: string, // "YYYY-MM"
): Promise<WorkerCalendarResponse> => {
  const res = await fetchWithAuth(`${BASE}/workers/${workerId}/calendar?month=${month}`);
  return handle<WorkerCalendarResponse>(res);
};
