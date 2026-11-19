// Shared fetch helpers for every Customer Portal page — one auth scheme
// (crm_portal_token), one set of endpoints, reused across the dashboard,
// booking, agreement, payments, documents, construction, tickets and
// profile pages instead of each page re-implementing its own fetch layer.
export const API = "/api/crm-portal";
export const BASE = API;

export function authHeaders() {
  const token = localStorage.getItem("crm_portal_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
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
// Every live transfer deed the customer is a party to (not tied to one application).
export const fetchTransferDeeds = () => get("/transfer-deeds");
// The customer's credit notes (money given back / invoices reduced).
export const fetchCreditNotes = () => get("/gst-notes");
/** Highest credit note id this customer has seen on Payments (per browser). */
export const creditNotesSeenKey = (customerId: any) => `portal-credit-notes-seen-${customerId}`;
export function readSeen(key: string) { try { return Number(localStorage.getItem(key) || 0); } catch { return 0; } }
export function writeSeen(key: string, v: number) { try { localStorage.setItem(key, String(v)); } catch { /* private mode */ } }

// ── Routes that require applicationId ────────────────────────────────────────
export const fetchTimeline          = (applicationId: number) => get(withAppId("/timeline", applicationId));
export const fetchTickets           = (applicationId: number) => get(withAppId("/tickets", applicationId));
export const fetchActivity          = (applicationId: number) => get(withAppId("/activity", applicationId));
/** What is waiting on the customer for this property — the server's one rule set (crmPortal.js needsYou), shared with the mobile app. */
export const fetchNeedsYou          = (applicationId: number) => get(withAppId("/needs-you", applicationId)).then((r: any) => r.items as any[]);
export const fetchAgreement         = (applicationId: number) => get(withAppId("/agreement", applicationId));
export const fetchAgreementDocuments = (applicationId: number) => get(withAppId("/agreement/documents", applicationId));
export const fetchInvoices          = (applicationId: number) => get(withAppId("/invoices", applicationId));
export const fetchReceipts          = (appId: number) => get(withAppId("/receipts", appId));
/** The property's money statement (crmPortal.js GET /money) — the one source of paid / total / balance, shared with the app. */
export const fetchMoney             = (applicationId: number) => get(withAppId("/money", applicationId));

/** The headline money figures every portal page shows, all from the money statement so no two pages disagree.
 *  A closed booking (cancelled, sold…) owes nothing: "paid" is then everything received on it. */
export function moneyFigures(m: any) {
  const t = m?.totals || {};
  const closed = !!m?.booking?.Closed;
  const total = Number(m?.plan?.total || 0);
  const paid = Number((closed ? t.received : t.paid) || 0);
  return {
    closed, total, paid,
    balance: closed ? 0 : Number(t.balance || 0),
    verifying: Number(t.verifying || 0),
    overPrice: closed ? 0 : Number(t.overPrice || 0),
    price: Number(m?.price?.total || 0),
    pct: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
  };
}

export const downloadReceiptPdf = async (receiptId: number, appId?: number): Promise<Blob> => {
  const token = localStorage.getItem("crm_portal_token");
  const aid = appId ?? (typeof window !== "undefined" ? Number(sessionStorage.getItem("crm_portal_app_id")) : undefined);
  const query = aid ? `?applicationId=${aid}` : "";
  const res = await fetch(`${BASE}/receipts/${receiptId}/pdf${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to download receipt");
  return res.blob();
};



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

/** Open a file the portal serves (signed-in fetch → new tab). */
async function openPortalFile(path: string, failMsg: string) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(failMsg);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const openPossessionLetter = (noticeId: number, applicationId: number) =>
  openPortalFile(`/possession-notice/${noticeId}/pdf?applicationId=${applicationId}`, "Could not open the letter");

/** The sale deed sent to the customer, with its papers (GET /sales-deed). */
export const fetchSalesDeed = (applicationId: number) => get(withAppId("/sales-deed", applicationId));
export const openSalesDeedDoc = (docId: number, applicationId: number) =>
  openPortalFile(`/sales-deed/documents/${docId}/download?applicationId=${applicationId}`, "Could not open the document");

/** A site photo as an object URL (signed-in fetch); the caller revokes it. */
export async function sitePhotoUrl(photoId: number, applicationId: number) {
  const res = await fetch(`${API}/site-photos/${photoId}?applicationId=${applicationId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Could not load the photo");
  return URL.createObjectURL(await res.blob());
}

/** Reopen a resolved help request that isn't fixed, with what is still wrong. */
export async function reopenTicket(applicationId: number, ticketId: number, reason: string) {
  const res = await fetch(`${API}/tickets/${ticketId}/reopen?applicationId=${applicationId}`, {
    method: "PUT", headers: authHeaders(), body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not reopen it");
  return res.json();
}

/** Rate a resolved help request (1–5, optional comment). */
export async function rateTicket(applicationId: number, ticketId: number, rating: number, feedback: string) {
  const res = await fetch(`${API}/tickets/${ticketId}/feedback?applicationId=${applicationId}`, {
    method: "PUT", headers: authHeaders(), body: JSON.stringify({ rating, feedback }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save the rating");
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
  decision: "Approve" | "Recheck",
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

export async function respondSalesDeed(applicationId: number, decision: "Approve" | "Recheck", remarks: string) {
  const res = await fetch(`${API}/sales-deed/respond?applicationId=${applicationId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision, remarks }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to respond to sales deed");
  return res.json();
}

export const fetchQueryPaymentAttachments = (applicationId: number) => get(withAppId("/query-payment/attachments", applicationId));

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