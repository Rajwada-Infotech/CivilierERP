// RN port of the data the web's Balance Sheet, Profit & Loss and Balance Enquiry pages read
// (src/pages/finance/BalanceSheet.tsx, ProfitAndLoss.tsx, src/api/balanceEnquiryApi.ts): same endpoints, same shapes.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function json<T>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data as T;
}

function qs(p: Record<string, string | number | null | undefined>) {
  return Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

// ─── Statements ──────────────────────────────────────────────────────────────

export interface Head { id: number | null; name: string; amount: number }
export interface StatementGroup { groupId: number | string; groupName: string; heads: Head[]; total: number }

export interface PartnerRollForward { key: string; name: string; opening: number; capitalIntroduced: number; credits: number; drawings: number; closing: number }
export interface PartnersCapital {
  openingCapital: number; furtherCapital: number; netProfitCurrent: number; drawings: number; total: number;
  capitalHeads: Head[]; partners: PartnerRollForward[];
}
export interface Ratios {
  currentRatio: number | null; quickRatio: number | null; workingCapital: number; debtToEquity: number | null;
  totalCurrentAssets: number; totalNonCurrentAssets: number; totalCurrentLiabilities: number; totalNonCurrentLiabilities: number; totalEquity: number;
}
export interface BalanceSheetResponse {
  asOf: string;
  companyName: string | null;
  entityType: string | null;
  partnersCapital: PartnersCapital;
  reservesAndSurplus: { retainedEarningsPrior: number; total: number };
  partnersDrawings: StatementGroup[];
  provisionsReserves: StatementGroup[];
  fixedLiabilities: StatementGroup[];
  currentLiabilities: StatementGroup[];
  fixedAssets: { tangible: StatementGroup[]; intangible: StatementGroup[] };
  investments: StatementGroup[];
  currentAssets: StatementGroup[];
  fictitiousAssets: StatementGroup[];
  totals: { liabilities: number; assets: number; difference: number };
  balanced: boolean;
  netProfit: number;
  ratios: Ratios | null;
}

export const fetchBalanceSheet = async (p: { asOf: string; companyId?: number | null; projectId?: number | null }) =>
  json<BalanceSheetResponse>(await fetchWithAuth(`/api/financial-statements/balance-sheet?${qs(p)}`));

export interface ExpenseSection { key: string; label: string; heads: Head[]; total: number }
export interface PLStatement {
  revenueFromOperations: { heads: Head[]; total: number };
  otherIncome: { heads: Head[]; total: number };
  totalRevenue: number;
  expenseSections: ExpenseSection[];
  totalExpenses: number;
  grossProfit: number;
  netProfit: number;
  directCosts: number;
  indirectTotal: number;
  taxExpense: { heads: Head[]; total: number };
}
export interface ProfitLossResponse {
  from: string;
  to: string;
  companyName: string | null;
  entityType: string | null;
  presentation: "structured" | "classic";
  income: StatementGroup[];
  expenses: StatementGroup[];
  totals: { income: number; expenses: number; netProfit: number };
  statement: PLStatement | null;
}

export const fetchProfitLoss = async (p: { from: string; to: string; companyId?: number | null; projectId?: number | null; costCenterId?: number | null }) =>
  json<ProfitLossResponse>(await fetchWithAuth(`/api/financial-statements/profit-loss?${qs(p)}`));

// ─── Balance enquiry ─────────────────────────────────────────────────────────

export interface EnquiryBank {
  BId: number; BName: string | null; BBranch: string | null; BAccountNumber: string | null; BIfscCode: string | null;
  BAccountType: string | null; BBankType: string | null; BOpeningBalance: number; BCompanyName: string | null; BStatus: boolean;
}
export interface BalanceSummary {
  bank: EnquiryBank; openingBalance: number; currentBalance: number; windowOpeningBalance: number;
  periodDebit: number; periodCredit: number; periodTxnCount: number; lastTransactionDate: string | null;
}
export interface PassbookEntry {
  EntryId: number; VoucherNo: string; VoucherDate: string; DebitAmount: number; CreditAmount: number; Narration: string | null;
  SourceType: string; SourceId: number; CompanyId: number | null; ProjectId: number | null;
  CostCenterId: number | null; CostCenterCode: string | null; CostCenterName: string | null;
  NewPaymentDocNo: string | null; ReceivedPaymentDocNo: string | null; JournalVoucherNo: string | null; FundTransferDocNo: string | null;
  RunningBalance: number;
}

export const getEnquiryBanks = async (companyName?: string) =>
  json<EnquiryBank[]>(await fetchWithAuth(`/api/balance-enquiry/banks${companyName ? `?companyName=${encodeURIComponent(companyName)}` : ""}`));

export const getBalanceSummary = async (bankId: number, p: { from?: string; to?: string }) =>
  json<BalanceSummary>(await fetchWithAuth(`/api/balance-enquiry/${bankId}/summary?${qs(p)}`));

export const getPassbook = async (bankId: number, p: { from?: string; to?: string; limit?: number }) =>
  json<{ bank: EnquiryBank; windowOpeningBalance: number; transactions: PassbookEntry[] }>(
    await fetchWithAuth(`/api/balance-enquiry/${bankId}/transactions?${qs(p)}`),
  );
