import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getBanks } from "@/api/bankMasterApi";
import { IFSC_BANK_MAP } from "./constants";
import type {
  BankOption,
  CardOption,
  ChequeLot,
  ExpenseOption,
  ExpenseDetail,
  GRNRef,
  ChainSummary,
} from "./types";

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export const fetchBankOptions = async (): Promise<BankOption[]> => {
  const banks = await getBanks();
  return banks
    .filter((b) => b.BStatus)
    .map((b) => ({
      id: b.BId,
      label: b.BName
        ? `${b.BName}${b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}`
        : `Bank #${b.BId}`,
      accountNumber: b.BAccountNumber,
      ifscCode: b.BIfscCode,
      branch: b.BBranch,
      accountType: b.BAccountType,
    }));
};

export const fetchChequeLots = async (
  bankId?: number | null,
): Promise<ChequeLot[]> => {
  const url = bankId
    ? `/api/new-payment/cheque-lots?bankId=${bankId}`
    : `/api/new-payment/cheque-lots`;
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

// Active cards for a bank — used by the Card-mode card selector.
// Mirrors fetchChequeLots: returns [] for any bank with no cards on file
// rather than erroring, since card registration is optional.
export const fetchCardsByBank = async (
  bankId?: number | null,
): Promise<CardOption[]> => {
  if (!bankId) return [];
  const res = await fetchWithAuth(`/api/card-master?bankId=${bankId}`);
  if (!res.ok) return [];
  const rows: any[] = await res.json().catch(() => ({}));
  return rows.map((r) => ({
    id: r.id,
    bank_id: r.bank_id ?? null,
    card_holder_name: r.card_holder_name ?? null,
    card_number: r.card_number ?? null,
    card_network: r.card_network ?? null,
    card_type: r.card_type ?? null,
    status: !!r.status,
  }));
};

export function bankNameFromIfsc(ifsc?: string | null): string | null {
  if (!ifsc || ifsc.length < 4) return null;
  const prefix = ifsc.slice(0, 4).toUpperCase();
  return IFSC_BANK_MAP[prefix] ?? prefix;
}

export const normaliseExpenseOptions = (items: any[]): ExpenseOption[] =>
  items.map((o: any) => ({
    ...o,
    companyName:
      o.companyName || o.ECompanyName || o.company_name || o.CompanyName || null,
    projectName:
      o.projectName ||
      o.EProjectDisplayName ||
      o.EProjectName ||
      o.project_name ||
      o.ProjectName ||
      null,
    financialYear:
      o.financialYear || o.EFinYear || o.fin_year || o.FinYear || null,
    supplierName:
      o.supplierName ||
      o.ESupplierName ||
      o.supplier_name ||
      o.SupplierName ||
      o.partyName ||
      o.EName ||
      null,
  }));

export const fetchExpenseDetail = async (
  id: string,
): Promise<ExpenseDetail | null> => {
  if (!id) return null;
  const res = await fetchWithAuth(`/api/expense-booking/${id}`);
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
};

export const fetchExpenseGRNs = async (expenseId: string): Promise<GRNRef[]> => {
  if (!expenseId) return [];
  const res = await fetchWithAuth(`/api/expense-booking/${expenseId}/grns`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

export const fetchPaymentSummary = async (
  expenseId: string,
): Promise<ChainSummary | null> => {
  if (!expenseId) return null;
  try {
    const res = await fetchWithAuth(
      `/api/expense-booking/${expenseId}/payment-summary`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const fetchWorkDoneById = async (
  id: number,
): Promise<{ ProjectName: string | null } | null> => {
  const res = await fetchWithAuth(`/api/engineering/work-done/${id}`);
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
};

export const fetchChequeNumbers = async (
  lotId: number,
): Promise<{ number: string; used: boolean; bounced: boolean }[]> => {
  const res = await fetchWithAuth(`/api/new-payment/cheque-numbers/${lotId}`);
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

export const deductChequeFromLot = async (
  lotId: number,
  chequeNo: string,
): Promise<{ remainingCheques: number; nextChequeNumber: string }> => {
  const res = await fetchWithAuth("/api/new-payment/deduct-cheque", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lotId, chequeNo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to deduct cheque from lot");
  }
  return res.json().catch(() => ({}));
};

export const fetchCompanyOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

export const fetchProjectOptions = async (): Promise<
  {
    id: number;
    label: string;
    belongs_to?: number | null;
    company_id?: number | null;
  }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

export const fetchSupplierOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  // Suppliers + Contractors — the Payee/Party field also has to resolve a
  // Contract's ContactPartyId, which can point to either.
  const res = await fetchWithAuth("/api/account-head/options?type=S,C");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

export const fetchFinYearOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => r.FStatus === 1 || r.FStatus === true)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};
