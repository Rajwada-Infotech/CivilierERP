// Notice Board: HR side (/api/employee-notices) and the employee's own notices (/api/employee-portal/notices).
import { fetchWithAuth } from "@/lib/fetchWithAuth";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(url, init ? { ...init, headers: { "Content-Type": "application/json" } } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export interface Notice {
  NoticeId: number; Title: string; Body: string; Audience: "All" | "Departments"; Priority: "Normal" | "Important"; IsPinned: boolean;
  PublishFrom: string; ExpiresOn: string | null; CreatedAt: string; UpdatedAt: string | null; CreatedByName: string | null;
  DepartmentIds: number[]; Departments: string | null; AudienceCount: number; ReadCount: number;
}
export interface NoticeDepartment { Id: number; DepartmentName: string; Employees: number }
export interface NoticeInput { title: string; body: string; audience: "All" | "Departments"; departmentIds: number[]; priority: "Normal" | "Important"; pinned: boolean; publishFrom: string; expiresOn: string }

const BASE = "/api/employee-notices";
export const getNotices = () => call<Notice[]>(BASE);
export const getNoticeDepartments = () => call<NoticeDepartment[]>(`${BASE}/departments`);
export const saveNotice = (id: number | null, body: NoticeInput) =>
  call<{ message: string }>(id ? `${BASE}/${id}` : BASE, { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
export interface NoticeReader { EmployeeId: number; EmployeeCode: string; EmployeeName: string; Department: string | null; Designation: string | null; ReadAt: string | null }
export const getNoticeReaders = (id: number) => call<NoticeReader[]>(`${BASE}/${id}/readers`);
export const deleteNotice = (id: number) => call<{ message: string }>(`${BASE}/${id}`, { method: "DELETE" });

// Employee side
export interface MyNotice { NoticeId: number; Title: string; Body: string; Priority: string; IsPinned: boolean; PublishFrom: string; ExpiresOn: string | null; PostedBy: string | null; ForWhom: string | null; IsRead: boolean }
export const getMyNotices = () => call<MyNotice[]>("/api/employee-portal/notices");
export const markNoticeRead = (id: number) => call<{ ok: boolean }>(`/api/employee-portal/notices/${id}/read`, { method: "POST", body: "{}" });
