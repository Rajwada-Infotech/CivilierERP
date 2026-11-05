// The agreement list, detail, history and eligible-booking fetches.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { API } from "./config";

export async function fetchAgreements(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

export const PAGE_SIZE = 20;
export interface AgreementListFilters {
  search: string;
  companyId: string;
  projectId: string;
  blockId: string;
}
export async function fetchAgreementsList(filters: AgreementListFilters, page: number): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  // Throws, so a failed load shows as one instead of an empty list.
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the agreements (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0 };
}
export async function fetchAgreementDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Failed to load agreement");
  return r.json();
}
export async function fetchAgreementIdByBooking(bookingId: string): Promise<number | null> {
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.agreement?.Id ?? null;
  } catch { return null; }
}
export async function fetchDateHistory(id: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${id}/date-history`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchRevisions(id: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${id}/revisions`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchWelcomeCallsForBooking(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`/api/crm/welcome-calls?bookingId=${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
