import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/debit-note";

export interface DebitNotePartyOption {
  id: number;
  label: string;
  type: string;
}

export interface DebitNoteInvoiceOption {
  billId: number;
  docNo: string;
  invoiceAmount: number | null;
  previousDebitAmount: number;
  adjustedInvoiceValue: number;
  totalPaid: number;
  remaining: number;
  billStatus: string | null;
  companyId: number | null;
  projectId: number | null;
  /** ExpenseBooking.ESourceType — GRN/PO/WO_PO/WORK_DONE/WO for an invoice
   * that came through Material Request -> PO -> GRN or Work Order -> PO
   * (item picker); null/TOD for a direct invoice (amount adjuster). */
  sourceType: string | null;
}

export interface DebitNoteHistoryEntry {
  id: number;
  DocNo: string;
  DebitDate: string;
  TotalAmount: number;
  Reason: string | null;
  Status: string;
  created_by_name: string | null;
  created_at: string;
}

export const getDebitNotePartyOptions = async (partyType: string): Promise<DebitNotePartyOption[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/party-options?type=${encodeURIComponent(partyType)}`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => []);
};

export const getInvoicesForParty = async (partyId: number): Promise<DebitNoteInvoiceOption[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/invoices-for-party/${partyId}`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => []);
};

export const getDebitNoteHistoryForInvoice = async (billId: number): Promise<DebitNoteHistoryEntry[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/for-invoice/${billId}`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => []);
};

export const getDebitNotes = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addDebitNote = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "POST failed");
  }
  return res.json().catch(() => ({}));
};

export const updateDebitNote = async (id: number, data: Record<string, unknown>) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
  }
  return res.json().catch(() => ({}));
};

export const deleteDebitNote = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "DELETE failed");
  }
  return res.json().catch(() => ({}));
};
