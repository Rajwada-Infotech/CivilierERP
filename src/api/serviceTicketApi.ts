import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/crm/service-tickets";

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
  CustomerFeedback: string | null;
  RaisedByCustomer: boolean;
  CreatedByName: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  UnitNo: string | null;
  ProjectName: string | null;
  ApplicantName: string | null;
  Mobile: string | null;
}

export interface TicketFilters {
  status?: string;
  priority?: string;
  category?: string;
  search?: string;
  companyId?: number;
  projectId?: number;
  blockId?: number;
  /** When true, restricts to bookings with CrmHandover.Status='Completed' (Maintenance module use) */
  handedOverOnly?: boolean;
  page?: number;
  pageSize?: number;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error((body as { error?: string; message?: string } | null)?.error || (body as { message?: string } | null)?.message || fallback);
}

export const getServiceTickets = async (
  filters: TicketFilters = {},
): Promise<ServiceTicketRow[] | { rows: ServiceTicketRow[]; total: number; page: number; pageSize: number }> => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}${suffix}`);
  return res.json().catch(() => []);
};

export const getTicketsForBooking = async (bookingId: number | string): Promise<ServiceTicketRow[]> => {
  const res = await fetchWithAuth(`${BASE}/booking/${bookingId}`);
  return res.json().catch(() => []);
};

export const createServiceTicket = async (data: {
  BookingId: number;
  Category: TicketCategory;
  Priority?: TicketPriority;
  Subject: string;
  Description?: string;
  AssignedTo?: number;
}) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to create ticket");
  return res.json();
};

export const updateServiceTicket = async (
  id: number,
  data: { Priority?: TicketPriority; AssignedTo?: number },
) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to update ticket");
  return res.json();
};

export const markTicketInProgress = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/mark-in-progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw await readError(res, "Failed to mark ticket in-progress");
  return res.json();
};

export const resolveServiceTicket = async (id: number, ResolutionNotes: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/resolve`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ResolutionNotes }),
  });
  if (!res.ok) throw await readError(res, "Failed to resolve ticket");
  return res.json();
};

export const closeServiceTicket = async (
  id: number,
  data?: { CustomerRating?: number; CustomerFeedback?: string },
) => {
  const res = await fetchWithAuth(`${BASE}/${id}/close`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) throw await readError(res, "Failed to close ticket");
  return res.json();
};

export const reopenServiceTicket = async (id: number, Reason: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reopen`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Reason }),
  });
  if (!res.ok) throw await readError(res, "Failed to reopen ticket");
  return res.json();
};
