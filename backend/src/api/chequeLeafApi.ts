import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/cheque-leaf";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
// A cheque leaf is an individual cheque drawn from a ChequeBook (ChequeMaster lot).
// Fields are based on what the ChequeLeaf table is expected to hold.
export interface ChequeLeaf {
  LeafId: number;
  ChequeBookId: number;           // FK → ChequeMaster (lot)
  ChequeNumber: string;           // Individual cheque number from the lot range
  BankId: number | null;
  BankName: string | null;
  AccountNumber: string | null;
  Status: "Available" | "Used" | "Cancelled" | "Void";
  IssuedTo: string | null;        // Payee name when issued
  IssuedDate: string | null;
  IssuedAmount: number | null;
  RefType: string | null;         // e.g. "Payment", "ExpenseBooking"
  RefId: number | null;
  Remarks: string | null;
  CompanyName: string | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

export interface ChequeLeafFilters {
  chequeBookId?: number;
  bankId?: number;
  status?: ChequeLeaf["Status"];
  search?: string;
}

// ─── NOTE: Backend is currently a stub (returns []) ──────────────────────────
// Full CRUD will be enabled once backend/routes/chequeLeaf.js is implemented.
// This api file is already wired so pages can import from here instead of
// using raw fetchWithAuth — no page changes needed when backend is ready.

// ─── GET ALL CHEQUE LEAVES (filterable) ───────────────────────────────────────
export const getChequeLeaves = async (
  filters: ChequeLeafFilters = {},
): Promise<ChequeLeaf[]> => {
  const qs = new URLSearchParams();
  if (filters.chequeBookId) qs.set("chequeBookId", String(filters.chequeBookId));
  if (filters.bankId) qs.set("bankId", String(filters.bankId));
  if (filters.status) qs.set("status", filters.status);
  if (filters.search?.trim()) qs.set("search", filters.search.trim());

  const url = qs.toString() ? `${BASE}?${qs.toString()}` : BASE;
  const res = await fetchWithAuth(url);
  return handleResponse<ChequeLeaf[]>(res);
};

// ─── The functions below are ready to use as soon as the backend implements them.

// ─── GET ONE ─────────────────────────────────────────────────────────────────
export const getChequeLeaf = async (id: number): Promise<ChequeLeaf> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse<ChequeLeaf>(res);
};

// ─── UPDATE STATUS (mark as Used / Cancelled / Void) ─────────────────────────
export const updateChequeLeafStatus = async (
  id: number,
  status: ChequeLeaf["Status"],
  meta?: {
    issuedTo?: string;
    issuedDate?: string;
    issuedAmount?: number;
    refType?: string;
    refId?: number;
    remarks?: string;
  },
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...meta }),
  });
  return handleResponse<{ success: boolean; message: string }>(res);
};