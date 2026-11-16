import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/legal/diligence";
const handle = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return body as T;
};
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface DiligenceArea { key: string; label: string; Status: string; Remarks?: string | null; CheckedAt?: string | null; CheckedByName?: string | null }
export interface RiskRow { RiskId: number; RiskLevel: string; AutoFlags: string | null; Remarks: string; FileId: number | null; FileName: string | null; AssessedAt: string; AssessedByName: string | null }
export interface ReviewRow {
  ReviewId: number; Status: string; AdvocateId: number | null; AdvocateName: string | null; AssignedOn: string | null; CompletedOn: string | null;
  Opinion: string | null; Observations: string | null; AdditionalDocs: string | null; Recommendation: string | null; FileId: number | null; FileName: string | null;
  CreatedAt: string; CreatedByName: string | null;
}
export interface Diligence {
  land: { LandId: number; LandCode: string; OwnershipType: string | null; OwnershipSource: string | null; SellerIdStatus: string | null; SellerAuthority: string | null;
    OwnersConsent: string | null; SellerContact: string | null; CurrentOwners: string | null; Inheritances: number; Transfers: number; LandRecords: number; Documents: number };
  areas: DiligenceArea[];
  restrictions?: { RestrictionId: number; Category: string; PermissionRequired: string; Status: string }[];
  cases?: { CaseId: number; CaseNumber: string; CourtName: string | null; StayType: string; StayDetails: string | null; ClearedAt: string | null; ClearRemarks: string | null; ClearedByName: string | null; CaseStatus: string }[];
  autoFlags: { level: string; text: string }[];
  autoLevel: string;
  risks: RiskRow[];
  reviews: ReviewRow[];
  blockers: string[];
  options: { areaStatus: string[]; riskLevels: string[]; reviewStatus: string[]; ownership: Record<string, string[]> };
  can: { verify: boolean; assessRisk: boolean; clear: boolean };
}

export const getDiligence = async (landId: number) => handle<Diligence>(await fetchWithAuth(`${BASE}/${landId}`));
export const saveOwnershipDetails = async (landId: number, body: Record<string, unknown>) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/ownership`, send("PUT", body)));
export const setDiligenceArea = async (landId: number, area: string, status: string, remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/area/${area}`, send("PUT", { status, remarks })));
export const addRiskAssessment = async (landId: number, body: Record<string, unknown>) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/risk`, send("POST", body)));
export const clearCourtCase = async (landId: number, caseId: number, remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/case/${caseId}/clear`, send("POST", { remarks })));
export const addLegalReview = async (landId: number, body: Record<string, unknown>) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/review`, send("POST", body)));

// Government-site data saved as evidence on a land (source, time, officer, comparison with our records).
export interface PortalFetchRow { FetchId: number; SiteName: string | null; SourceUrl: string | null; Response: string | null; MatchResult: string | null; Remarks: string | null; FetchedAt: string; FetchedByName: string | null }
export const getPortalFetches = async (landId: number) => handle<PortalFetchRow[]>(await fetchWithAuth(`${BASE}/${landId}/fetches`));
export const savePortalFetch = async (landId: number, body: Record<string, unknown>) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/fetches`, send("POST", body)));

// Succession share suggestion (never a decision) per inheritance.
export interface ShareLine { id: number; name: string; role: string | null; recordedPct: number | null; suggestedPct: number | null; rule: string | null; validated: boolean; note: string }
export interface InheritanceSuggestion {
  inheritance: { InheritanceId: number; DeceasedName: string; SuccessionLaw: string | null; ShareDecision: string | null; ShareDecisionRemarks: string | null; ShareDecisionAt: string | null; ShareDecisionByName: string | null };
  heirs: { id: number; name: string }[];
  result: { lines: ShareLine[]; notes: string[]; allValidated: boolean } | null;
}
export const getInheritanceSuggestions = async (landId: number) => handle<{ items: InheritanceSuggestion[]; canDecide: boolean }>(await fetchWithAuth(`${BASE}/${landId}/inheritances`));
export const decideHeirShares = async (inheritanceId: number, decision: string, remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/inheritance/${inheritanceId}/decision`, send("POST", { decision, remarks })));
