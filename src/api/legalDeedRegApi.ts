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
  ConsTotalAmount: number | null; ConsAdvanceAmount: number | null; Queries: number; QueryTotal: number | null;
  RegAppliedAt: string | null; RegDaysOpen: number | null; RegFinalDate: string | null; RegDeedNo: string | null; RegDeedFileId: number | null;
  RegCompletedAt: string | null; IgrStatus: string | null; DeedLocation: string | null;
}
export interface DeedRegLand extends Omit<DeedRegRow, "Queries" | "QueryTotal"> {
  JLNo: string | null; RsKhatianNo: string | null; LrKhatianNo: string | null; Area: number | null; UnitName: string | null;
  L1By: string | null; L2By: string | null; Owners: string | null; GovtValue: number | null; DeedFileId: number | null; DeedFileName: string | null;
  ConsRate: number | null; ConsRateUnitId: number | null; ConsRateUnit: string | null; ConsPaymentModeId: number | null; ConsPaymentMode: string | null; ConsRemarks: string | null;
  RegAppliedByName: string | null; RegOfficeId: number | null; RegOffice: string | null; RegModeId: number | null; RegMode: string | null;
  RegDeedFileName: string | null; RegCompletedByName: string | null;
  IgrTrackingUrl: string | null; IgrStatusId: number | null; DeedLocationId: number | null;
}
export interface StampQuery { QueryId: number; QueryDate: string; FeeTypeId: number | null; FeeType: string | null; Amount: number; Remarks: string | null; ByName: string | null }
export interface TrackRow { TrackId: number; StatusDate: string; IgrStatus: string | null; DeedLocation: string | null; TrackingUrl: string | null; Remarks: string | null; ByName: string | null }

export const getDeedRegList = async (tab: "active" | "registered") => handle<{ lands: DeedRegRow[]; canApply: boolean }>(await fetchWithAuth(`${BASE}/list?tab=${tab}`));
export const getDeedRegLand = async (id: number) => handle<{ land: DeedRegLand; queries: StampQuery[]; tracking: TrackRow[]; canApply: boolean }>(await fetchWithAuth(`${BASE}/${id}`));
export const saveConsideration = async (id: number, b: { total: string; rate: string; rateUnitId: string; advance: string; paymentModeId: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/consideration`, send("PUT", b)));
export const addStampQuery = async (id: number, b: { queryDate: string; feeTypeId: string; amount: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/query`, send("POST", b)));
export const deleteStampQuery = async (qid: number) => handle<Msg>(await fetchWithAuth(`${BASE}/query/${qid}`, send("DELETE")));
export const saveFinalRegistration = async (id: number, b: { date: string; officeId: string; modeId: string; deedNo: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/final`, send("PUT", b)));
export const addDeedTracking = async (id: number, b: { statusDate: string; igrStatusId: string; deedLocationId: string; trackingUrl: string; remarks: string }) =>
  handle<Msg>(await fetchWithAuth(`${BASE}/${id}/tracking`, send("POST", b)));

export const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
