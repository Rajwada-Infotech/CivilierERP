import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Legal V3 land intelligence: parcels & area reconciliation, ownership events, family, inheritance cases.
const BASE = "/api/legal/intel";
async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface ParcelArea {
  ParcelId: number; ParcelCode: string; RsDagNo: string | null; LrDagNo: string | null; CsDagNo: string | null; UnitName: string | null; MouzaName: string | null; ParcelStatus: string;
  areas: Record<string, number | null>; diffPct: number; flags: string[];
}
export const getReconciliation = async (q: { landId?: number; enquiryId?: number }) =>
  handle<{ parcels: ParcelArea[] }>(await fetchWithAuth(`${BASE}/reconciliation?${q.landId ? `landId=${q.landId}` : `enquiryId=${q.enquiryId}`}`));

export interface EventParty { PartyId: number; EventId: number; PartyRole: string; PersonName: string; OwnerKind: string; SharePct: number | null; ShareFraction: string | null; Relationship: string | null }
export interface OwnershipEventRow {
  EventId: number; EventDate: string; EffectiveDate: string | null; EventType: string | null; ApprovalStatus: string; DeedNo: string | null; DocumentNo: string | null;
  TransferSharePct: number | null; ParcelCode: string | null; PreviousOwnerName: string | null; NewOwnerName: string | null; InheritanceId: number | null;
  ApprovalRemarks: string | null; ApprovedByName: string | null; ApprovedAt: string | null; CreatedByName: string | null; parties: EventParty[];
}
export const getLandEvents = async (landId: number) =>
  handle<{ events: OwnershipEventRow[]; openDisputes: { Claimant: string; DisputeType: string; DisputeStatus: string; InheritanceId: number | null }[] }>(await fetchWithAuth(`${BASE}/land/${landId}/events`));
export const decideEvent = async (id: number, decision: string, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/event/${id}/decision`, post({ decision, remarks })));

export interface FamilyMember { MemberId: number; InheritanceId: number | null; FullName: string; Gender: string | null; RelatedToMemberId: number | null; RelationToRelated: string | null;
  RelationToDeceased: string | null; IsDeceasedOwner: boolean; IsAlive: boolean; DateOfDeath: string | null; IsMinor: boolean; IsMissing: boolean; RelationshipStatus: string }
export const getFamily = async (landId: number) => handle<{ members: FamilyMember[] }>(await fetchWithAuth(`${BASE}/land/${landId}/family`));

export interface CalcLine { memberId: number; name: string; relation: string; head: string; fractionOfEstate: string; pctOfEstate: number; fractionOfParcel: string; pctOfParcel: number; area?: number; areaUnit?: string; minor: boolean }
export interface InheritanceCalc { CalcId: number; VersionNo: number; Framework: string | null; RuleVersion: string; Outcome: string; Explanation: string | null; CalcStatus: string;
  CreatedAt: string; CreatedByName: string | null; ReviewedAt: string | null; ReviewedByName: string | null; ReviewRemarks: string | null; result: { lines: CalcLine[]; total: string | null; reasons: string[] } | null }
export interface InheritanceCase {
  case: { InheritanceId: number; LandId: number; DeceasedName: string; DateOfDeath: string | null; DeceasedGender: string | null; ApplicableFramework: string | null; PersonalLaw: string | null;
    SchoolOfLaw: string | null; PropertyType: string | null; NatureOfOwnership: string | null; SuccessionType: string | null; AvailableSharePct: number | null; AvailableShareFraction: string | null;
    ParcelCode: string | null; ParcelArea: number | null; ParcelUnit: string | null; FrameworkConfirmedByName: string | null; FrameworkConfirmedAt: string | null; LegalOfficerName: string | null;
    ReviewStatus: string; ReviewRemarks: string | null };
  members: { MemberId: number; FullName: string; RelationToDeceased: string | null; IsAlive: boolean; IsMinor: boolean; IsMissing: boolean; RelationshipStatus: string; IsDeceasedOwner: boolean }[];
  calcs: InheritanceCalc[]; disputes: { Claimant: string; DisputeType: string; DisputeStatus: string }[]; flags: string[]; ruleVersion: string;
}
export const getInheritanceCase = async (id: number) => handle<InheritanceCase>(await fetchWithAuth(`${BASE}/inheritance/${id}`));
export const confirmFramework = async (id: number, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/inheritance/${id}/confirm-framework`, post({ remarks })));
export const calculateShares = async (id: number) => handle<{ message: string; outcome: string }>(await fetchWithAuth(`${BASE}/inheritance/${id}/calculate`, post({})));
export const reviewCalc = async (id: number, decision: "Approved" | "Rejected", remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/calc/${id}/review`, post({ decision, remarks })));
export const inheritanceAction = async (id: number, action: string, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/inheritance/${id}/workflow`, post({ action, remarks })));

// ── Pre-registration classification & conversion ──
export interface PreRegParcel {
  ParcelId: number; ParcelCode: string; Dag: string | null; RsDagNo: string | null; LrDagNo: string | null; CurrentClass: string | null; ProposedClass: string | null; ProposedLandUse: string | null;
  ConversionRequired: string | null; ConversionStage: string | null; AssessmentStatus: string; AssessmentRemarks: string | null; AssessedByName: string | null; AssessedAt: string | null;
  ConversionId: number | null; ConversionStatus: string | null; VerificationStatus: string | null; ApplicationNo: string | null; TargetDate: string | null; AssignedName: string | null;
  blockers: string[]; gate: "Blocked" | "Clear";
}
export interface PreRegLand { LandId: number; LandCode: string; LandName: string | null; ProjectId: number | null; ProjectName: string | null; WorkflowStatus: string; MouzaName: string | null;
  EnquiryNo: string | null; JLNo: string | null; ok: boolean; parcels: PreRegParcel[]; blockers: string[] }
export interface PreRegCounts { prePending: number; preOverdue: number; underProcess: number; orderVerificationPending: number; registrationBlocked: number; assessmentPending: number; notApplicablePending: number; postPending: number }
export const getPreReg = async (project: string) => handle<{ lands: PreRegLand[]; counts: PreRegCounts }>(await fetchWithAuth(`${BASE}/prereg?project=${encodeURIComponent(project)}`));
export const decideAssessment = async (parcelId: number, decision: "Approved" | "Returned" | "Rejected", remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/parcel/${parcelId}/assessment`, post({ decision, remarks })));
export const submitPreRegConversion = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/prereg-conversion/${id}/submit`, post({})));
export const verifyPreRegConversion = async (id: number, decision: "Verified" | "Returned", remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/prereg-conversion/${id}/verify`, post({ decision, remarks })));
