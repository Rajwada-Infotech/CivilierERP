// RN port of the data layer of src/pages/finance/TrialBalance.tsx — same
// endpoints/types. Only the FY period mode is ported (web also has Range
// and As On tabs); FY covers the common case and this app already leans on
// FY-scoped fetches elsewhere (Invoice, Payment).
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface BalancePair {
  debit: number;
  credit: number;
}

export interface TBNode {
  id: number;
  name: string;
  code?: string | null;
  level: number;
  isGroup: boolean;
  type?: string;
  children: TBNode[];
  opening: BalancePair;
  transactions: BalancePair;
  closing: BalancePair;
}

export interface TBSummary {
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
}

export interface TBResponse {
  rows: TBNode[];
  summary: TBSummary;
  asOf: string;
}

export interface TBTransaction {
  entryId: number;
  voucherNo: string | null;
  date: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  sourceType: string | null;
  sourceId: number | null;
  invoiceNo: string | null;
  costCenter: { id: number; code: string | null; name: string | null } | null;
}

export interface TBTransactionsResponse {
  entity: { id: number; name: string; type: string };
  transactions: TBTransaction[];
}

export interface CCTransaction {
  entryId: number;
  voucherNo: string | null;
  date: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  account: { id: number; name: string | null; type: string | null };
  docNo: string | null;
  poNo: string | null;
}

export interface CCTransactionsResponse {
  costCenter: { id: number; code: string | null; name: string | null };
  transactions: CCTransaction[];
  totals: { debit: number; credit: number };
}

export interface FinYearRow {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus?: number | boolean;
  FisLocked?: number | boolean;
}

export interface Option {
  id: number;
  label: string;
  company_id?: number;
}

export function toDateStr(s: string) {
  return s ? s.slice(0, 10) : "";
}

export async function fetchFinYears(): Promise<FinYearRow[]> {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data: FinYearRow[] = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : [])
    .filter((f) => !(f.FisLocked === 1 || f.FisLocked === true) && (f.FStatus === 1 || f.FStatus === true))
    .sort((a, b) => new Date(b.FEndDate).getTime() - new Date(a.FEndDate).getTime());
}

export async function fetchCompanyOptionsTB(): Promise<Option[]> {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchProjectOptionsTB(): Promise<Option[]> {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchCostCenterOptions(): Promise<Option[]> {
  const res = await fetchWithAuth("/api/cost-center/options");
  if (!res.ok) return [];
  const d = await res.json().catch(() => []);
  return (Array.isArray(d) ? d : []).map((c: any) => ({ id: c.id, label: c.code ? `${c.code} - ${c.label}` : c.label }));
}

export interface TBParams {
  from: string;
  to: string;
  companyId?: number | null;
  projectId?: number | null;
  costCenterId?: number | null;
}

function buildQuery(p: TBParams): string {
  const qs = new URLSearchParams({ from: p.from, to: p.to });
  if (p.companyId) qs.set("companyId", String(p.companyId));
  if (p.projectId) qs.set("projectId", String(p.projectId));
  if (p.costCenterId) qs.set("costCenterId", String(p.costCenterId));
  return qs.toString();
}

export async function fetchTrialBalance(p: TBParams): Promise<TBResponse> {
  const res = await fetchWithAuth(`/api/trial-balance?${buildQuery(p)}`);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchTrialBalanceEntityTransactions(nodeId: number, p: TBParams): Promise<TBTransactionsResponse> {
  const res = await fetchWithAuth(`/api/trial-balance/${nodeId}/transactions?${buildQuery(p)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchCostCentreTransactions(costCenterId: number, p: TBParams): Promise<CCTransactionsResponse> {
  const res = await fetchWithAuth(`/api/trial-balance/cost-centre/${costCenterId}/transactions?${buildQuery(p)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
