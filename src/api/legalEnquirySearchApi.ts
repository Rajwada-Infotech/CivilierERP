import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/legal/enquiry-search";
const handle = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return body as T;
};
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export interface SearchOptions {
  officeTypes: { OfficeTypeId: number; OfficeType: string; Days: number; FromYear: number; StateName: string | null }[];
  offices: { OfficeId: number; OfficeName: string; OfficeTypeId: number | null; OfficeType: string; DistrictName: string | null; StateName: string | null }[];
  years: number[];
}
export interface EnquiryHit {
  EnquiryId: number; EnquiryNo: string; LandLocation: string; EnquiryStatus: string; FinYear: string | null; JLNo: string | null;
  RsDagNo: string | null; LrDagNo: string | null; RsKhatianNo: string | null; LrKhatianNo: string | null;
  LandId: number | null; LandCode: string | null; DistrictName: string | null; StateName: string | null; ProjectId?: number | null; ProjectName?: string | null; MouzaName: string | null; EnquiryDate: string;
  /** Office timelines: one per office type, started when the enquiry was saved. */
  OfficesTotal: number; OfficesDone: number; NextDue: string | null; DaysOver: number; Found: number;
}
export type SearchTab = "pending" | "done" | "all";
export interface OfficeSearch {
  OfficeSearchId: number; EnquiryId: number; OfficeTypeId: number | null; OfficeType: string; OfficeId: number | null; OfficeName: string | null; SlaDays: number; FromYear: number; DueDate: string;
  Status: "Pending" | "Completed"; Remarks: string | null; CompletedAt: string | null; CompletedByName: string | null; DaysOver: number;
  EnquiryNo?: string; ProjectId?: number | null; ProjectName?: string | null;
}
export interface YearResult {
  SearchId: number; OfficeType: string; CalendarYear: number; Status: "Found" | "Not Found" | "Requested"; DeedNo: string | null; DeedDate: string | null;
  Parties: string | null; Details: string | null; SiteName: string | null; RecordedAt: string; RecordedByName: string | null;
}
export interface YearBody { calendarYear?: number; result: "Found" | "Not Found"; deedNo?: string; deedDate?: string; parties?: string; details?: string; siteName?: string }

export const getSearchOptions = async () => handle<SearchOptions>(await fetchWithAuth(`${BASE}/options`));
export const findEnquiries = async (projectId: number | "all" | "none", q: string, tab: SearchTab = "all") =>
  handle<EnquiryHit[]>(await fetchWithAuth(`${BASE}/find?projectId=${projectId}&tab=${tab}&q=${encodeURIComponent(q)}`));
export const getEnquirySearches = async (enquiryId: number) => handle<{ offices: OfficeSearch[]; years: YearResult[] }>(await fetchWithAuth(`${BASE}/${enquiryId}`));
export const getOverdueSearches = async () => handle<OfficeSearch[]>(await fetchWithAuth(`${BASE}/overdue`));
export const setOfficeOf = async (id: number, officeId: number | null) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}`, send("PUT", { officeId })));
export const addYearResult = async (id: number, body: YearBody) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/year`, send("POST", body)));
export const editYearResult = async (searchId: number, body: YearBody) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/item/${searchId}`, send("PUT", body)));
export const deleteYearResult = async (searchId: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/item/${searchId}`, send("DELETE")));
export const completeOffice = async (id: number, remarks: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/complete`, send("POST", { remarks })));
export const reopenOffice = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/reopen`, send("POST", {})));
export const addYearRange = async (id: number, body: { from: number; to: number; siteName?: string; details?: string }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/range`, send("POST", body)));
export const addOffice = async (body: { officeName: string; officeTypeId: number; enquiryId: number }) =>
  handle<{ OfficeId: number; OfficeName: string; OfficeType: string; message: string }>(await fetchWithAuth(`${BASE}/offices`, send("POST", body)));

/** Days counter for a due date: "5 days left", "Due today", "3 days overdue". */
export function daysCounter(due: string | null | undefined): { text: string; tone: "ok" | "warn" | "over" } | null {
  if (!due) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${due}T00:00:00`);
  const n = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (n > 0) return { text: `${n} day${n > 1 ? "s" : ""} left`, tone: n <= 1 ? "warn" : "ok" };
  if (n === 0) return { text: "Due today", tone: "warn" };
  return { text: `${-n} day${n < -1 ? "s" : ""} overdue`, tone: "over" };
}

export interface SearchFigures { Enquiries: number; Searches: number; Completed: number; NotCompleted: number; Overdue: number; OnTime: number; DeedsFound: number; EnquiriesDone?: number }
export interface SearchReport {
  projects: (SearchFigures & { ProjectId: number | null; ProjectName: string })[];
  offices: (SearchFigures & { OfficeType: string })[];
  total: SearchFigures | null;
}
export const getSearchReport = async () => handle<SearchReport>(await fetchWithAuth(`${BASE}/report`));
