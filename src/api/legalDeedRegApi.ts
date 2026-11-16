import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/legal/deed-reg";
const handle = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return body as T;
};
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
type Msg = { message: string };

export interface DeedRegRow {
  LandId: number; LandCode: string; LandName: string; DistrictName: string | null; MouzaName: string | null; WorkflowStatus: string;
  RsDagNo: string | null; LrDagNo: string | null; DeedTargetDate: string | null; L2ApprovedAt: string | null;
  ConsTotalAmount: number | null; ConsAdvanceAmount: number | null; Paid: number; InstalmentsOverdue?: number; Queries: number; QueryTotal: number | null;
  RegAppliedAt: string | null; RegDaysOpen: number | null; RegFinalDate: string | null; RegDeedNo: string | null; RegDeedFileId: number | null;
  RegCompletedAt: string | null; IgrStatus: string | null; DeedLocation: string | null;
}
export interface DeedRegLand extends Omit<DeedRegRow, "Queries" | "QueryTotal"> {
  JLNo: string | null; RsKhatianNo: string | null; LrKhatianNo: string | null; Area: number | null; UnitName: string | null;
  L1By: string | null; L2By: string | null; Owners: string | null; GovtValue: number | null; DeedFileId: number | null; DeedFileName: string | null;
  ConsDate: string | null; LastPaid: string | null; ConsRate: number | null; ConsRateUnitId: number | null; ConsRateUnit: string | null; ConsPaymentModeId: number | null; ConsPaymentMode: string | null; ConsRemarks: string | null;
  RegAppliedByName: string | null; RegOfficeId: number | null; RegOffice: string | null; RegModeId: number | null; RegMode: string | null;
  RegDeedFileName: string | null; RegCompletedByName: string | null;
  IgrTrackingUrl: string | null; IgrStatusId: number | null; DeedLocationId: number | null;
}
export interface StampQuery { QueryId: number; QueryDate: string; FeeTypeId: number | null; FeeType: string | null; Amount: number; Remarks: string | null; ByName: string | null }
export interface PaymentRow { PaymentId: number; PaymentDate: string; Purpose: string | null; Amount: number; Mode: string | null; Payee: string | null; TransactionRef: string | null; ReceiptNo: string | null; ReceiptFileId: number | null; ReceiptFileName: string | null; Remarks: string | null; ByName: string | null }
export interface ScheduleRow { ScheduleId: number; DueDate: string; Amount: number; SharePct: number | null; Label: string | null; Purpose: string | null; Remarks: string | null }
export interface InstalmentTemplate { name: string; totalPct: number; lines: { SeqNo: number; Label: string; SharePct: number; DueDays: number; Purpose: string | null }[] }
export interface RevisionRow { RevisionId: number; RevisionDate: string; OldTotal: number | null; NewTotal: number; OldRate: number | null; NewRate: number | null; Reason: string | null; ValuationDate: string | null; ByName: string | null }
export interface ValuationRow { ValuationId: number; ValuationDate: string; GovernmentValuation: number | null; EstimatedMarketValue: number | null; MarketRate: number | null; ValuationSource: string | null }
export interface TrackRow { TrackId: number; StatusDate: string; IgrStatus: string | null; DeedLocation: string | null; TrackingUrl: string | null; Remarks: string | null; ByName: string | null }

export const getDeedRegList = async (tab: "active" | "registered") => handle<{ lands: DeedRegRow[]; canApply: boolean }>(await fetchWithAuth(`${BASE}/list?tab=${tab}`));
export const getDeedRegLand = async (id: number) => handle<{ land: DeedRegLand; queries: StampQuery[]; tracking: TrackRow[]; payments: PaymentRow[]; schedule: ScheduleRow[]; revisions: RevisionRow[]; valuation: ValuationRow | null; canApply: boolean }>(await fetchWithAuth(`${BASE}/${id}`));
export const saveConsideration = async (id: number, b: { total: string; rate: string; rateUnitId: string; consDate: string; paymentModeId: string; remarks: string; reason?: string; valuationId?: number | null }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/consideration`, send("PUT", b)));
export const addStampQuery = async (id: number, b: { queryDate: string; feeTypeId: string; amount: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/query`, send("POST", b)));
export const deleteStampQuery = async (qid: number) => handle<Msg>(await fetchWithAuth(`${BASE}/query/${qid}`, send("DELETE")));
export const saveFinalRegistration = async (id: number, b: { date: string; officeId: string; modeId: string; deedNo: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/final`, send("PUT", b)));
export const addDeedTracking = async (id: number, b: { statusDate: string; igrStatusId: string; deedLocationId: string; trackingUrl: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/tracking`, send("POST", b)));

export const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
export const addPayment = async (id: number, b: { paymentDate: string; txnTypeId: string; amount: string; paymentModeId: string; payee: string; transactionRef: string; receiptNo: string; receiptFileId?: number | null; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/payment`, send("POST", b)));
export const deletePayment = async (pid: number) => handle<Msg>(await fetchWithAuth(`${BASE}/payment/${pid}`, send("DELETE")));
export const getInstalmentTemplates = async () => handle<InstalmentTemplate[]>(await fetchWithAuth(`${BASE}/instalment-templates`));
export const applyInstalmentTemplate = async (id: number, template: string, replace = false) => {
  const res = await fetchWithAuth(`${BASE}/${id}/schedule/apply`, send("POST", { template, replace }));
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body?.needsReplace) return { needsReplace: true as const, message: body.error as string };
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return { needsReplace: false as const, message: body.message as string };
};
export const addInstalment = async (id: number, b: { dueDate: string; amount: string; percent: string; label: string; txnTypeId: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/schedule`, send("POST", b)));
export const deleteInstalment = async (sid: number) => handle<Msg>(await fetchWithAuth(`${BASE}/schedule/${sid}`, send("DELETE")));
