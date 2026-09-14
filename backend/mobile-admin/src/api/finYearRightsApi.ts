// RN port of the fetch/mapping logic in src/contexts/FinYearContext.tsx +
// src/api/finYearApi.ts (web) — same /api/fin-year endpoint, same
// FId/FName/FStartDate/FEndDate/FStatus/FisLocked → FinYear mapping. Unlike
// web's context (query-cache + optimistic patches), this app just refetches
// after each mutation, same convention as every other mobile-admin screen.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface FinYear {
  id: string;
  year: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Closed";
  locked: boolean;
}

function toLocalDateStr(val: string): string {
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const getAllFinYears = async (): Promise<FinYear[]> => {
  const res = await fetchWithAuth("/api/fin-year?all=true");
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  const data = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : [])
    .map((item: any): FinYear => ({
      id: String(item.FId),
      year: item.FName || "",
      startDate: item.FStartDate ? toLocalDateStr(item.FStartDate) : "",
      endDate: item.FEndDate ? toLocalDateStr(item.FEndDate) : "",
      status: item.FStatus ? "Active" : "Closed",
      locked: !!item.FisLocked,
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
};

export const addFinYear = async (fy: { year: string; startDate: string; endDate: string; locked: boolean }) => {
  const res = await fetchWithAuth("/api/fin-year", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fy_label: fy.year, start_date: fy.startDate, end_date: fy.endDate, is_locked: fy.locked }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Save failed");
  }
  return res.json().catch(() => ({}));
};

export const updateFinYear = async (id: string, fy: { year: string; startDate: string; endDate: string; locked: boolean }) => {
  const res = await fetchWithAuth(`/api/fin-year/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fy_label: fy.year, start_date: fy.startDate, end_date: fy.endDate, is_locked: fy.locked }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Save failed");
  }
  return res.json().catch(() => ({}));
};

export const toggleFinYearLock = async (id: string, locked: boolean) => {
  const res = await fetchWithAuth(`/api/fin-year/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_locked: locked }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to change lock");
  }
  return res.json().catch(() => ({}));
};

export const deleteFinYear = async (id: string) => {
  const res = await fetchWithAuth(`/api/fin-year/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Delete failed");
  }
  return res.json().catch(() => ({}));
};
