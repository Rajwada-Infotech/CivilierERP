import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/legal/enquiry-search";
const handle = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return body as T;
};
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export interface SearchOptions {
  officeTypes: { OfficeTypeId: number; OfficeType: string; Days: number; FromYear: number; ToYear?: number | null; StateName: string | null; SourceKind?: SourceKind; IsMandatory?: boolean }[];
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
  OfficeSearchId: number; EnquiryId: number; OfficeTypeId: number | null; OfficeType: string; ManualAdd?: boolean; Mandatory?: boolean; ToYear?: number | null; ExceptionNote?: string | null; SourceKind?: SourceKind; OfficeId: number | null; OfficeName: string | null; SlaDays: number; FromYear: number; DueDate: string;
  Status: "Pending" | "Completed"; Remarks: string | null; CompletedAt: string | null; CompletedByName: string | null; DaysOver: number;
  EnquiryNo?: string; ProjectId?: number | null; ProjectName?: string | null;
}
export interface YearResult {
  SearchId: number; OfficeType: string; CalendarYear: number; Status: YearStatus | "Requested"; SearchMethod?: string | null; ReferenceNo?: string | null; SearchDate?: string | null; EvidenceFileId?: number | null; EvidenceFileName?: string | null; DeedNo: string | null; DeedDate: string | null;
  Parties: string | null; Details: string | null; SiteName: string | null; RecordedAt: string; RecordedByName: string | null;
}
export type SourceKind = "Survey record" | "Registry office" | "Land record office" | "Other";
export const YEAR_STATUSES = ["Found", "Not Found", "Not Applicable", "Under Review", "Certified Copy Requested", "Awaiting Office Response", "Unable to Access", "Record Not Digitised"] as const;
export type YearStatus = typeof YEAR_STATUSES[number];
export const SEARCH_METHODS = ["Online portal", "Certified copy", "Office inspection", "Manual entry"] as const;
export type RecordType = "CS" | "RS" | "LR";
export interface LandRecord { Id: number; Dag: string; Khatian: string; RecordedHolder: string | null; GuardianName: string | null; Area: number | null; Unit: string | null; LandClass: string | null; RecordYear: number | null; RecordStatus: string; SourceMethod: string | null; DocFileId: number | null }
export interface RecordMap { MapId: number; FromType: RecordType; FromId: number; ToType: RecordType; ToId: number; MatchStatus: string; MatchBasis: string | null; Remarks: string | null;
  EvidenceFileId: number | null; EvidenceFileName: string | null; ByName: string | null; At: string; differences: { kind: string; from: string; to: string }[]; fromLinks: number; toLinks: number }
export interface EnquiryRecords { CS: LandRecord[]; RS: LandRecord[]; LR: LandRecord[]; maps: RecordMap[]; unlinked: { type: RecordType; id: number; dag: string; khatian: string }[]; matchStatuses: string[] }
export const getEnquiryRecords = async (enquiryId: number) => handle<EnquiryRecords>(await fetchWithAuth(`${BASE}/${enquiryId}/records`));
export const addRecordMap = async (enquiryId: number, body: { fromType: RecordType; fromId: number; toType: RecordType; toId: number; matchStatus: string; matchBasis?: string; remarks?: string; evidenceFileId?: number }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${enquiryId}/map`, send("POST", body)));
export const editRecordMap = async (id: number, body: { matchStatus: string; matchBasis?: string; remarks?: string; evidenceFileId?: number }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/map/${id}`, send("PUT", body)));
export const raiseDiscrepancies = async (mapId: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/map/${mapId}/discrepancy`, send("POST", {})));
type Row = Record<string, string | number | boolean | null>;
export interface LandRecordsSummary {
  enquiry: Row; sources: Row[]; found: Row[]; records: { CS: Row[]; RS: Row[]; LR: Row[] }; maps: Row[]; discrepancies: Row[]; alternative: Row[]; possession: Row[];
  review: Row | null; documents: Row[]; observations: string[]; overall: string;
  figures: Record<"totalSources" | "completed" | "pending" | "overdue" | "mandatoryOpen" | "found" | "notFound" | "notApplicable" | "waiting" | "exceptions" | "openDiscrepancies" | "seriousOpen" | "mappingPending", number>;
}
export const getSearchSummary = async (enquiryId: number) => handle<LandRecordsSummary>(await fetchWithAuth(`${BASE}/${enquiryId}/summary`));
export const deleteRecordMap = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/map/${id}`, send("DELETE")));
export interface YearBody { calendarYear?: number; result: YearStatus; deedNo?: string; deedDate?: string; parties?: string; details?: string; siteName?: string; searchMethod?: string; referenceNo?: string; searchDate?: string; evidenceFileId?: number }

export const getSearchOptions = async () => handle<SearchOptions>(await fetchWithAuth(`${BASE}/options`));
export const findEnquiries = async (projectId: number | "all" | "none", q: string, tab: SearchTab = "all") =>
  handle<EnquiryHit[]>(await fetchWithAuth(`${BASE}/find?projectId=${projectId}&tab=${tab}&q=${encodeURIComponent(q)}`));
/** One page of enquiries for the Deed Registry Search queue (kind: pending · overdue · ontime · done). */
export const findEnquiriesPage = async (projectId: number | "all" | "none", q: string, page: number, kind?: string, pageSize = 20) =>
  handle<{ items: EnquiryHit[]; total: number; page: number; pageSize: number }>(await fetchWithAuth(
    `${BASE}/find?projectId=${projectId}&tab=all&q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}${kind ? `&kind=${kind}` : ""}`));
export const getEnquirySearches = async (enquiryId: number) => handle<{ offices: OfficeSearch[]; years: YearResult[] }>(await fetchWithAuth(`${BASE}/${enquiryId}`));
export const getOverdueSearches = async (project = "all") => handle<OfficeSearch[]>(await fetchWithAuth(`${BASE}/overdue?project=${encodeURIComponent(project)}`));
export const setOfficeOf = async (id: number, officeId: number | null) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}`, send("PUT", { officeId })));
export const addYearResult = async (id: number, body: YearBody) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/year`, send("POST", body)));
export const editYearResult = async (searchId: number, body: YearBody) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/item/${searchId}`, send("PUT", body)));
export const deleteYearResult = async (searchId: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/item/${searchId}`, send("DELETE")));
export const completeOffice = async (id: number, remarks: string, exception?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/complete`, send("POST", { remarks, exception })));
export const reopenOffice = async (id: number, reason: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/reopen`, send("POST", { reason })));
/** Search earlier years too (records before the usual start year are needed). */
export const setOfficeFromYear = async (id: number, fromYear: number, reason: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/from-year`, send("PUT", { fromYear, reason })));
export const addYearRange = async (id: number, body: { from: number; to: number; siteName?: string; details?: string; status?: "Not Found" | "Not Applicable" | "Under Review" }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/office/${id}/range`, send("POST", body)));
export const addOffice = async (body: { officeName: string; officeTypeId: number; enquiryId: number }) =>
  handle<{ OfficeId: number; OfficeName: string; OfficeType: string; message: string }>(await fetchWithAuth(`${BASE}/offices`, send("POST", body)));

/** One more search for an enquiry: an existing type, or a new name (added to Setup → Registration Office Types). */
export const addEnquirySearch = async (enquiryId: number, body: { officeTypeId?: number; name?: string; fromYear?: number; slaDays?: number }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${enquiryId}/add-search`, send("POST", body)));

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
export interface InvestigationFigures { CsFound: number; RsFound: number; LrFound: number; DeedsFound: number; OtherFound: number; OpenDiscrepancies: number; SeriousDiscrepancies: number;
  OwnerDifferences: number; AreaMismatches: number; MappingPending: number; ReviewsPending: number; Proceed: number | null; OnHold: number | null; NotRecommended: number | null }
export interface SearchReport {
  projects: (SearchFigures & { ProjectId: number | null; ProjectName: string })[];
  offices: (SearchFigures & { OfficeType: string })[];
  total: SearchFigures | null;
  investigation?: InvestigationFigures | null;
}
export const getSearchReport = async () => handle<SearchReport>(await fetchWithAuth(`${BASE}/report`));
