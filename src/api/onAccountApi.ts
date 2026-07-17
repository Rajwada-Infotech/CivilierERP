import { fetchWithAuth } from "../lib/fetchWithAuth";

export interface OABalance {
  partyId: number | null;
  partyType: string | null;
  partyLabel: string | null;
  balance: number;
}

export interface OAReportRow {
  OAId: number;
  PartyId: number;
  PartyName: string;
  PartyType: string;
  TxnDate: string;
  TxnType: "CREDIT" | "DEBIT";
  Amount: number;
  OnAccountCreated: number;
  OnAccountAdjusted: number;
  RunningBalance: number;
  RefDocNo: string | null;
  AdjRefDocNo: string | null;
  CompanyName: string;
  ProjectName: string;
  Notes: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface OAPartySummary {
  PartyId: number;
  PartyName: string;
  PartyType: string;
  TotalCredit: number;
  TotalDebit: number;
  Balance: number;
}

const BASE = "/api/on-account";

export async function getOABalanceByRef(expenseRef: string): Promise<OABalance> {
  const r = await fetchWithAuth(`${BASE}/balance-by-ref/${encodeURIComponent(expenseRef)}`);
  if (!r.ok) return { partyId: null, partyType: null, partyLabel: null, balance: 0 };
  return r.json();
}

export async function getOABalance(partyId: number): Promise<OABalance> {
  const r = await fetchWithAuth(`${BASE}/balance/${partyId}`);
  if (!r.ok) return { partyId, partyType: null, partyLabel: null, balance: 0 };
  return r.json();
}

export interface OAInvoice {
  docNo: string;
  invoiceAmount: number;
  totalPaid: number;
  remaining: number;
  billStatus: string | null;
}

export async function getInvoicesForParty(partyId: number): Promise<OAInvoice[]> {
  const r = await fetchWithAuth(`${BASE}/invoices-for-party/${partyId}`);
  if (!r.ok) return [];
  return r.json();
}

export interface OAInvoiceAdjustment {
  amount: number;
  partyId: number;
  partyName: string;
  date: string;
}

/** On Account adjustments already applied to a specific invoice — used by
 *  the Payment page to show "On A/C adjusted with ₹X from <Supplier>" when
 *  that invoice is picked again for payment. */
export async function getOAAdjustmentsForInvoice(
  expenseRef: string,
): Promise<OAInvoiceAdjustment[]> {
  if (!expenseRef) return [];
  const r = await fetchWithAuth(
    `${BASE}/adjustments-for-invoice/${encodeURIComponent(expenseRef)}`,
  );
  if (!r.ok) return [];
  return r.json();
}

export async function applyOAAdjustment(payload: {
  expenseRef: string;
  amount: number;
  partyId?: number;
  paymentDocNo?: string;
  paymentId?: number;
}): Promise<{ applied: number; remainingBalance: number }> {
  const r = await fetchWithAuth(`${BASE}/apply-adjustment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? "Failed to apply On Account adjustment");
  return body;
}

export async function getOAReport(filters: {
  companyId?: string;
  projectId?: string;
  partyId?: string;
  partyType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: OAReportRow[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v != null && v !== "") params.set(k, String(v)); });
  const r = await fetchWithAuth(`${BASE}/report?${params}`);
  if (!r.ok) throw new Error("Failed to load On Account report");
  return r.json();
}

export async function getOAPartySummary(): Promise<OAPartySummary[]> {
  const r = await fetchWithAuth(`${BASE}/party-summary`);
  if (!r.ok) return [];
  return r.json();
}
