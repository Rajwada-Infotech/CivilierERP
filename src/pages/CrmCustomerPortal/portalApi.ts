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
    throw new Error(body.error || "Forbidden");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

// Appends ?applicationId={id} — required on every detail route after the
// multi-app rework (JWT now carries customerId only; applicationId is
// validated per-request server-side).
function withAppId(path: string, applicationId: number) {
  return `${path}?applicationId=${applicationId}`;
}

// ── Routes that don't need applicationId ──────────────────────────────────────
export const fetchMe          = () => get("/me");
export const fetchApplications = () => get("/applications");

// ── Routes that require applicationId ────────────────────────────────────────
export const fetchTimeline          = (applicationId: number) => get(withAppId("/timeline", applicationId));
export const fetchTickets           = (applicationId: number) => get(withAppId("/tickets", applicationId));
export const fetchActivity          = (applicationId: number) => get(withAppId("/activity", applicationId)).catch(() => []);
export const fetchAgreement         = (applicationId: number) => get(withAppId("/agreement", applicationId)).catch(() => null);
export const fetchAgreementDocuments = (applicationId: number) => get(withAppId("/agreement/documents", applicationId)).catch(() => []);
export const fetchInvoices          = (applicationId: number) => get(withAppId("/invoices", applicationId)).catch(() => []);

export async function uploadAgreementDocument(docId: number, file: File, applicationId: number) {
  const token = localStorage.getItem("crm_portal_token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/agreement/documents/${docId}/upload${withAppId("", applicationId).replace("", "?")}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
  return res.json();
}

// Cleaner version of uploadAgreementDocument with proper query string
export async function uploadAgreementDoc(docId: number, file: File, applicationId: number) {
  const token = localStorage.getItem("crm_portal_token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/agreement/documents/${docId}/upload?applicationId=${applicationId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
  return res.json();
}

export async function respondPossessionNotice(decision: "Acknowledge" | "Dispute", applicationId: number, reason?: string) {
  const res = await fetch(`${API}/possession-notice/respond?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision, reason }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to respond");
  return res.json();
}

export async function proposeAgreementDate(proposedDate: string, applicationId: number) {
  const res = await fetch(`${API}/agreement/propose-date?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ proposedDate }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to propose date");
  return res.json();
}

// Accept the company's currently-proposed date as-is, no re-typing it.
// Only valid when ProposedDateStatus === 'PendingCustomerReview' — i.e. it's
// currently the customer's turn to respond to what the company proposed.
export async function acceptAgreementDate(applicationId: number) {
  const res = await fetch(`${API}/agreement/date/accept?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to accept date");
  return res.json();
}

export async function respondAgreement(
  applicationId: number,
  decision: "Approve" | "Reject",
  remarks: string,
  proposedDate?: string
) {
  const res = await fetch(`${API}/agreement/respond?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision, remarks, proposedDate }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to respond to agreement");
  return res.json();
}

export async function respondSalesDeed(applicationId: number, decision: "Approve" | "Reject", remarks: string) {
  const res = await fetch(`${API}/sales-deed/respond?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision, remarks }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to respond to sales deed");
  return res.json();
}

export const fetchQueryPaymentAttachments = (applicationId: number) => get(withAppId("/query-payment/attachments", applicationId)).catch(() => []);

// Files travel as base64 JSON, decoded server-side into the same
// VARBINARY(MAX) column staff uploads use — see crmPortal.js POST
// /query-payment/proof.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUri = reader.result as string;
      resolve(dataUri.slice(dataUri.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadQueryPaymentProof(applicationId: number, file: File) {
  const base64 = await fileToBase64(file);
  const res = await fetch(`${API}/query-payment/proof?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64 }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to upload proof of payment");
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