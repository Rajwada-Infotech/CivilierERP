import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Land Management pipeline (backend/routes/legal/landPipeline.js): one workflow per Land ID.
const BASE = "/api/legal/land";

export type StepStatus = "Not Started" | "In Progress" | "Pending Verification" | "Completed" | "Correction Required" | "Skipped";

export interface PipelineStep {
  stepNo: number;
  code: string;
  name: string;
  phase: number;
  skippable: boolean;
  status: StepStatus;
  remarks: string | null;
  skipReason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  responsible: string | null;
  /** The step's screen exists in this build (later steps come phase by phase). */
  live: boolean;
  /** An earlier step is still open. */
  locked: boolean;
  /** What the step still needs before it can be Completed. */
  missing: string[];
}

export interface LandPipeline {
  land: {
    LandId: number; LandCode: string; LandName: string; DistrictName: string | null; MouzaId: number | null; MouzaName: string | null;
    JLNo: string | null; Area: number | null; UnitName: string | null; LandStatus: string; WorkflowStatus: string | null;
    IsOnHold: boolean; IsActive: boolean; EnquiryNo: string | null; IsCancelled: boolean; CancelReason: string | null; CancelledAt: string | null;
    EntryType?: "New Acquisition" | "Existing / Backlog";
  };
  hold: { HoldCategory: string; HoldReason: string; HoldDate: string; ExpectedReviewDate: string | null; HeldByName: string | null } | null;
  steps: PipelineStep[];
  counts: { parties: number; owners: number; rs: number; lr: number; recordsVerified: number; ownershipRecords: number; docsRequired: number; docsDone: number };
  warnings: string[];
  progress: number;
  holdCategories: string[];
  milestones: { deedRegistered: boolean; mutationCompleted: boolean; settlementApproved: boolean; transactionClosed: boolean };
}

export interface LandSummaryItem {
  LandId: number;
  LandCode: string;
  LandName: string;
  EntryType?: string;
  LandStatus: string;
  PossessionStatus?: string | null;
  WorkflowStatus: string | null;
  IsOnHold?: boolean;
  Area: number | null;
  UnitName: string | null;
  DistrictName: string | null;
  MouzaName: string | null;
  JLNo: string | null;
  VerificationStatus: string;
  L1Status: string;
  L2Status: string;
  CreatedAt: string;
  LastUpdated: string;
}

export interface LandPendingQueueItem {
  LandId: number;
  LandCode: string;
  LandName: string;
  EntryType?: string;
  LandStatus: string;
  VerificationStatus: string;
  L1Status: string;
  L2Status: string;
  WorkflowStatus: string | null;
  Area: number | null;
  UnitName: string | null;
  DistrictName: string | null;
  MouzaName: string | null;
  JLNo: string | null;
  Stage: "Verification Pending" | "L1 Legal Review" | "L2 Executive Approval" | "Approved";
  WaitingDays: number;
  CreatedAt: string;
  LastUpdated: string;
  CreatedByName: string | null;
}

export interface LandStats {
  totalLands: number;
  pendingVerificationLands?: number;
  l1PendingLands?: number;
  l2PendingLands?: number;
  activeEnquiries: number;
  inProgress: number;
  onHold: number;
  pendingVerification: number;
  completed: number;
  /** Existing / backlog land (already owned). */
  backlogLands?: number;
  /** Sale transactions, disposed / inactive land, and RS / LR records across all land. */
  sales?: number; disposed?: number; rsRecords?: number; lrRecords?: number;
  recent: { LandId: number; LandCode: string; LandName: string; WorkflowStatus: string | null; IsOnHold: boolean; MouzaName: string | null; JLNo: string | null }[];
  allLands?: LandSummaryItem[];
  pendingRegistration: number;
  mutationPending: number;
  approvals: { Kind: string; N: number }[];
  /** Land waiting for record approval (Data Verification → L1 → L2), oldest first. */
  awaitingApproval: { LandId: number; LandCode: string; LandName: string; WorkflowStatus: string | null; Stage: string; Since: string }[];
  payments: { PaymentDate: string; Amount: number; TransactionRef: string | null; LandId: number; LandCode: string; LandName: string }[];
  cases: { CaseNumber: string; CourtName: string; NextHearingDate: string | null; Status: string; LandId: number; LandCode: string }[];
  transfers: { EventDate: string; FromName: string; ToName: string; TransferType: string | null; LandId: number; LandCode: string }[];
}

export interface AuditEvent {
  EventId: number; Action: string; EntityType: string; EntityId: number | null; OldValue: string | null; NewValue: string | null;
  Remarks: string | null; CreatedAt: string; UserName: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getLandStats = async () => handle<LandStats>(await fetchWithAuth(`${BASE}/stats`));
export const getLandPipeline = async (id: number) => handle<LandPipeline>(await fetchWithAuth(`${BASE}/${id}`));
export const getLandAudit = async (id: number) => handle<AuditEvent[]>(await fetchWithAuth(`${BASE}/${id}/audit`));

/** A land's profile overview (both entry types): identity, current owners and record counts. */
export interface LandOverview {
  land: {
    LandId: number; LandCode: string; LandName: string; EntryType: "New Acquisition" | "Existing / Backlog" | "Newly Acquired"; LandStatus: string;
    PossessionStatus: string | null; WorkflowStatus: string | null; IsOnHold: boolean; IsActive: boolean; Area: number | null; UnitName: string | null;
    LocationAddress: string | null; AcquisitionDate: string | null; AcquisitionDateApprox: boolean; AcquisitionType?: string | null;
    RsDagNo: string | null; LrDagNo: string | null; RsKhatianNo: string | null; LrKhatianNo: string | null;
    DistrictName: string | null; SubDivisionName?: string | null; BlockName?: string | null; MouzaName: string | null; JLNo: string | null;
    LandTypeName?: string | null; NorthBoundary?: string | null; SouthBoundary?: string | null; EastBoundary?: string | null; WestBoundary?: string | null;
    GpsLatitude?: number | null; GpsLongitude?: number | null; Remarks?: string | null;
    VerificationStatus?: string; L1Status?: string; L1ReviewedAt?: string | null; L1Remarks?: string | null; L1ReviewerName?: string | null;
    L2Status?: string; L2ApprovedAt?: string | null; L2Remarks?: string | null; L2ApproverName?: string | null;
    CreatedAt: string; LastUpdated: string; CreatedByName: string | null;
  };
  owners: { OwnerName: string | null; SharePct: number; ValidFrom: string; VerificationStatus: string }[];
  counts: Record<"ownershipRecords" | "transfers" | "documents" | "documentsUnverified" | "activeCases" | "legalRecords" | "legalHistory" | "activeMortgages" | "mortgages"
    | "mutations" | "payments" | "taxRecords" | "valuations" | "landRecords" | "awaitingVerification", number>;
}
export const getLandOverview = async (id: number) => handle<LandOverview>(await fetchWithAuth(`${BASE}/${id}/overview`));
export const moveLandStep = async (id: number, code: string, body: { status: StepStatus; remarks?: string; skipReason?: string }) =>
  handle<{ message: string; reverify: string[] }>(await fetchWithAuth(`${BASE}/${id}/steps/${code}`, post(body)));
export const holdLand = async (id: number, body: { category: string; reason: string; expectedReviewDate?: string; remarks?: string }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/hold`, post(body)));
export const resumeLand = async (id: number, remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/resume`, post({ remarks })));
export interface LandFinance {
  transactions: { TransactionId: number; TransactionNo: string; TxnType: string; BuyerName: string; SellerNames: string; TotalValue: number; AdvanceAmount: number | null; TxnStatus: string; Verified: number; Unverified: number; Balance: number }[];
  expenses: { ExpenseType: string; Amount: number }[];
  registrationFees: number;
}
export const getLandFinance = async (id: number) => handle<LandFinance>(await fetchWithAuth(`${BASE}/${id}/finance`));
export interface LandRegister {
  landCode: string; landName: string; mouza: string | null; area: string | null; remainingArea: string | null;
  owners: { name: string; guardian: string | null; sharePct: number; since: string; verification: string }[];
  rsReferences: string[]; lrReferences: string[];
  latestDeed: { number: string; date: string; approval: string } | null;
  mutationStatus: string; legalStatus: string; settlementStatus: string; workflowStatus: string | null;
}
export const getLandRegister = async (id: number) =>
  handle<{ current: LandRegister; snapshots: { SnapshotId: number; CreatedAt: string; Remarks: string | null; CreatedByName: string | null; snapshot: LandRegister }[] }>(await fetchWithAuth(`${BASE}/${id}/register`));
export const updateLandRegister = async (id: number, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/register/snapshot`, post({ remarks })));
export const initFinalChecks = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/final-checks/init`, post({})));
export const cancelLand = async (id: number, reason: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/cancel`, post({ reason })));
export const recordOwnershipTransfer = async (id: number, body: {
  registeredDeedId: number; transferDate: string; sellers: { recordId: number; sharePct: number }[]; buyers: { name: string; guardian?: string; sharePct: number }[]; remarks?: string;
}) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/ownership-transfer`, post(body)));

export const getLandReports = async () => handle<{ key: string; group: string; title: string }[]>(await fetchWithAuth(`/api/legal/land-reports`));
export const getLandReport = async (key: string) =>
  handle<{ title: string; columns: string[]; rows: Record<string, unknown>[] }>(await fetchWithAuth(`/api/legal/land-reports/${key}`));

export interface OwnershipChange {
  first?: boolean;
  date: string;
  transferTypeId?: number;
  from?: { recordId: number; sharePct: number }[];
  to: { name: string; guardian?: string; relationshipTypeId?: number; sharePct: number }[];
  docTypeId?: number; documentNo?: string; deedNo?: string; fileId?: number;
  registrationOfficeId?: number; registrationDate?: string; transferValue?: number;
  inheritance?: { dateOfDeath?: string; deathCertFileId?: number; heirCertFileId?: number; supportingType?: string; supportingFileId?: number; mutationRecordNo?: string };
  partitionNewReferences?: string;
  remarks?: string;
}
export const recordOwnershipChange = async (id: number, body: OwnershipChange) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/ownership/change`, post(body)));
export const updateOwnershipChange = async (id: number, date: string, body: {
  date: string; docTypeId?: number; documentNo?: string; deedNo?: string; fileId?: number; transferValue?: number; remarks?: string;
  owners: { eventId: number; name: string; guardian?: string; relationshipTypeId?: number }[];
}) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/ownership/change/${date}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
export const undoOwnershipChange = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/ownership/undo`, post({})));

export const startPurchaseFromOwners = async (id: number, body: { buyerName: string; buyerId?: number; totalValue: number; advanceAmount?: number }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/purchase/from-owners`, post(body)));
export const addOwnersToApprovals = async (id: number, agreementId: number) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/approvals/from-owners`, post({ agreementId })));
export type LandDossier = Record<"owners" | "chain" | "records" | "documents" | "legal" | "transactions" | "deeds" | "mutations" | "steps" | "legalRecords" | "loans" | "payments" | "taxes" | "valuations", Record<string, unknown>[]> & { land: Record<string, unknown> };
export const getLandDossier = async (id: number) => handle<LandDossier>(await fetchWithAuth(`${BASE}/${id}/dossier`));

export const initDueDiligence = async (id: number) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/due-diligence/init`, post({})));
export const setEnquiryStatus = async (id: number, status: "Rejected" | "On Hold" | "Under Review", reason?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/enquiries/${id}/status`, post({ status, reason })));
export const convertEnquiry = async (id: number, landName?: string) =>
  handle<{ landId: number; landCode: string; message: string }>(await fetchWithAuth(`${BASE}/enquiries/${id}/convert`, post({ landName })));

// ── Land-Wise Verification, Two-Level Approvals & Cascade Deletion ───────────

export const verifyLand = async (id: number, remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/verify`, post({ remarks })));

export const submitLandForL1 = async (id: number) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/submit-l1`, post({})));

export const actionLandL1 = async (id: number, action: "Approve" | "Return", remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/action-l1`, post({ action, remarks })));

export const actionLandL2 = async (id: number, action: "Approve" | "Return" | "Reject", remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/action-l2`, post({ action, remarks })));

export const getLandPendingQueue = async () =>
  handle<LandPendingQueueItem[]>(await fetchWithAuth(`${BASE}/pending-queue`));

/** Delete a land and everything recorded on it. `confirmCode` must be the land's Land ID. */
export const deleteLand = async (id: number, confirmCode: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmCode }) }));
