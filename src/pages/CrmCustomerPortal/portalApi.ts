// Shared fetch helpers for every Customer Portal page — one auth scheme
// (crm_portal_token), one set of endpoints, reused across the dashboard,
// booking, agreement, payments, documents, construction, tickets and
// profile pages instead of each page re-implementing its own fetch layer.
export const API = "/api/crm-portal";

export function authHeaders() {
  const token = localStorage.getItem("crm_portal_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body.mustChangePassword) throw new Error("password_change_required");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

export const fetchMe = () => get("/me");
export const fetchTimeline = () => get("/timeline");
export const fetchTickets = () => get("/tickets");
export const fetchActivity = () => get("/activity").catch(() => []);
export const fetchAgreement = () => get("/agreement").catch(() => null);
export const fetchAgreementDocuments = () => get("/agreement/documents").catch(() => []);
export const fetchInvoices = () => get("/invoices").catch(() => []);

export async function uploadAgreementDocument(docId: number, file: File) {
  const token = localStorage.getItem("crm_portal_token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/agreement/documents/${docId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
  return res.json();
}

export async function respondPossessionNotice(decision: "Acknowledge" | "Dispute", reason?: string) {
  const res = await fetch(`${API}/possession-notice/respond`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision, reason }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to respond");
  return res.json();
}

export async function proposeAgreementDate(proposedDate: string) {
  const res = await fetch(`${API}/agreement/propose-date`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ proposedDate }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to propose date");
  return res.json();
}

export const TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];

export function fmtMoney(n: number | null | undefined) {
  return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
}
export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export function maskAadhaar(v: string | null | undefined) {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return v;
  return `XXXX XXXX ${digits.slice(-4)}`;
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
