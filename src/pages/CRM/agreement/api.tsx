// The agreement list, detail, history and eligible-booking fetches.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { API } from "./config";

export async function fetchAgreements(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

/** One page of the list for the given query (page, sort, status, search, filters), with the counts by status. */
export async function fetchAgreementsList(params: URLSearchParams): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  // Throws, so a failed load shows as one instead of an empty list.
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the agreements (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
}
/** Every agreement matching the query, sorted (the Excel export). */
export async function fetchAllAgreements(params: URLSearchParams): Promise<any[]> {
  const p = new URLSearchParams(params);
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the agreements (${r.status}).`);
  return data;
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
