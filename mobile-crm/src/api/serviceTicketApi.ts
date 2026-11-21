// RN client for CRM Service Tickets — used by the mobile-maintenance app to
// view and action service requests raised by handed-over residents.
// Mirrors src/api/serviceTicketApi.ts shapes; endpoint is the same backend.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export type TicketStatus = "Open" | "Assigned" | "InProgress" | "Resolved" | "Closed" | "Reopened";
export type TicketCategory = "Warranty" | "Complaint" | "ServiceRequest" | "SocietyIssue" | "Legal" | "Modification" | "Other";
export type TicketPriority = "Low" | "Normal" | "High" | "Urgent";

export interface ServiceTicketRow {
  Id: number;
  TicketNo: string;
  BookingId: number;
  BookingNo: string;
  Category: TicketCategory;
  Priority: TicketPriority;
  Subject: string;
  Description: string | null;
  Status: TicketStatus;
  AssignedTo: number | null;
  AssigneeName: string | null;
  SlaDueDate: string | null;
  ResolvedAt: string | null;
  ResolutionNotes: string | null;
  CustomerRating: number | null;
  RaisedByCustomer: boolean;
  CreatedAt: string;
  UnitNo: string | null;
  ProjectName: string | null;
  ApplicantName: string | null;
  Mobile: string | null;
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

async function act(url: string, body: object, fallback: string): Promise<void> {
  const res = await fetchWithAuth(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
}

const BASE = "/api/crm/service-tickets";

export const getHandedOverTickets = (params: { status?: string; search?: string } = {}): Promise<ServiceTicketRow[]> => {
  const qs = new URLSearchParams({ handedOverOnly: "true" });
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  return getJson<ServiceTicketRow[]>(`${BASE}?${qs.toString()}`, "Failed to load service requests");
};

export const getTicketsForBooking = (bookingId: number | string): Promise<ServiceTicketRow[]> =>
  getJson<ServiceTicketRow[]>(`${BASE}/booking/${bookingId}`, "Failed to load tickets");

export const createServiceTicket = async (data: {
  BookingId: number;
  Category: TicketCategory;
  Priority?: TicketPriority;
  Subject: string;
  Description?: string;
}): Promise<void> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to create ticket");
  }
};

export const markTicketInProgress = (id: number) =>
  act(`${BASE}/${id}/mark-in-progress`, {}, "Failed to mark in progress");

export const resolveServiceTicket = (id: number, ResolutionNotes: string) =>
  act(`${BASE}/${id}/resolve`, { ResolutionNotes }, "Failed to resolve ticket");

export const closeServiceTicket = (id: number) =>
  act(`${BASE}/${id}/close`, {}, "Failed to close ticket");