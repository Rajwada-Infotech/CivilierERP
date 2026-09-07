// RN port of src/pages/masters/DebitNoteMaster.tsx + src/api/debitNoteApi.ts.
// This "Debit Note" is an AP/finance discount note raised against an
// unpaid Expense Booking bill (or EMI installment) — it has NO relation to
// GRN/PO/stock at all, unlike the similarly-named "Quality Rejection Debit
// Note" (src/api/qualityRejectionDebitNoteApi.ts / mobile's
// qualityRejectionDebitNoteApi.ts), which is a separate table/feature
// raised against a received GRN/Vehicle-In-Out line. Web's DebitNoteMaster
// page displays that other feature read-only in a second section — ported
// the same way here (see DebitNoteListScreen.tsx's mode toggle) but never
// creates/edits/cancels it from this screen, matching web.
//
// Scope decisions vs. web (both intentional deviations, not gaps):
//  1. Dropped the "discount %/amount vs. bill" preview panel — web computes
//     it client-side only and never sends it to the backend at all
//     (confirmed in toPayload()), so it has zero functional effect; keeping
//     it would just be UI complexity for a number nobody stores.
//  2. Added the Reason field to the form — the column and POST/PUT body
//     already fully support it server-side, web's form just never surfaces
//     an input for it despite that. Since it's already wired the full way
//     through, exposing it here closes an obvious usability gap rather
//     than perpetuating dead capability.
//  3. Wired real create/edit/delete gating via usePageRights — web's own
//     form shows Edit/Delete to every user regardless of actual page
//     rights (a bug: MasterPage's canEdit/canDelete default to true and
//     DebitNoteMaster.tsx never overrides them), relying on the server's
//     403 alone. Mobile gates the buttons properly instead.
// Also unported: DocNo/docTypeId (dead columns — no code path ever
// populates DocNo), and the unused Status lifecycle (defaults to "Draft"
// and nothing ever transitions it — only `is_active` is a real toggle).
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/debit-note";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DebitNoteItem {
  Description: string;
  Quantity: number | null;
  UOMSymbol: string | null;
  Rate: number | null;
  Amount: number | null;
}

export interface DebitNote {
  id: number;
  DocNo: string | null;
  DebitDate: string | null;
  company_id: number | null;
  project_id: number | null;
  supplier_id: number | null;
  bill_id: number | null;
  is_active: boolean;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string | null;
  Reason: string | null;
  TotalAmount: number | null;
  Status: string;
  company_name?: string | null;
  project_name?: string | null;
  supplier_name?: string | null;
  items?: DebitNoteItem[];
}

export interface CreateDebitNotePayload {
  company_id: number;
  project_id: number;
  supplier_id: number;
  bill_id: number;
  is_active: boolean;
  DebitDate: string | null;
  Reason: string | null;
  items: DebitNoteItem[];
}

// ─── CRUD (no pagination on web — full list every time) ────────────────────

export const getDebitNotes = async (): Promise<DebitNote[]> => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch debit notes"));
  return normalizeArray<DebitNote>(await res.json().catch(() => []));
};

export const getDebitNoteById = async (id: number | string): Promise<DebitNote> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch debit note"));
  return res.json().catch(() => ({}));
};

export const createDebitNote = async (payload: CreateDebitNotePayload) => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create debit note"));
  return res.json().catch(() => ({}));
};

export const updateDebitNote = async (id: number | string, payload: CreateDebitNotePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update debit note"));
  return res.json().catch(() => ({}));
};

export const deleteDebitNote = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete debit note"));
  return res.json().catch(() => ({}));
};

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export interface ProjectOption extends NameOption { companyId: string | null }

export const getProjects = async (): Promise<ProjectOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
};

export const getSuppliers = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/account-head/options?type=S").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((s) => ({ id: String(s.id), name: s.label ?? "" }));
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => (r.FStatus === 1 || r.FStatus === true) && !r.FLocked)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

export interface BillOption {
  id: string;
  label: string;
  type: "booking" | "emi";
  expenseBookingId: number;
  docNo: string | null;
  projectName: string | null;
  partyName: string | null;
  supplierName: string | null;
  partyId: number | null;
  amount: number;
  companyId: number | null;
  companyName: string | null;
  financialYear: string | null;
}

export const getBillOptions = async (finYear?: string, partyId?: string | number): Promise<BillOption[]> => {
  const qs = new URLSearchParams();
  if (finYear) qs.set("finYear", finYear);
  if (partyId) qs.set("partyId", String(partyId));
  const raw = await fetchWithAuth(`/api/expense-booking/options?${qs}`).then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((o) => ({
    id: String(o.id ?? o.value), label: o.label ?? "", type: o.type === "emi" ? "emi" : "booking",
    expenseBookingId: o.expenseBookingId, docNo: o.docNo ?? null, projectName: o.projectName ?? null,
    partyName: o.partyName ?? null, supplierName: o.supplierName ?? null, partyId: o.partyId ?? null,
    amount: Number(o.amount) || 0, companyId: o.companyId ?? null, companyName: o.companyName ?? null,
    financialYear: o.financialYear ?? null,
  }));
};
