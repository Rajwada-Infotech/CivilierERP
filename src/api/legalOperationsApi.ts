import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/legal";

export interface LegalCandidateItem {
  CandidateId: number;
  SessionId?: number;
  CandidateRef: string;
  DeedNo: string;
  DeedYear: number;
  DeedDate?: string | null;
  OfficeId?: number;
  PartySummary?: string | null;
  PropertySummary?: string | null;
  VerificationStatus: "Unverified" | "Verified" | "Rejected";
  VerificationNotes?: string | null;
  VerifiedByName?: string | null;
  VerifiedAt?: string | null;
}

export interface LegalSearchItem {
  SearchId: number;
  SearchNumber: string;
  PlannedSearchDate: string;
  ActualSearchDate: string | null;
  OfficeId: number;
  OfficeName: string;
  OfficeCode: string;
  PortalLinkId: number | null;
  PortalUrl: string | null;
  LinkLabel: string | null;
  AssignedUserId: number | null;
  AssignedUserName: string | null;
  MouzaId: number | null;
  MouzaName: string | null;
  JLNo: string | null;
  PlotNo: string | null;
  KhatianNo: string | null;
  RsDag?: string | null;
  LrDag?: string | null;
  RsKhatian?: string | null;
  LrKhatian?: string | null;
  PartyName: string | null;
  DeedNo?: string | null;
  DeedYear?: number | null;
  SearchOutcome: string;
  OfficialReceiptRef: string | null;
  ReceiptAmount: number | null;
  SearchNotes: string | null;
  Status: string;
  Candidates?: LegalCandidateItem[];
}

export interface LegalDeedSummary {
  DeedRecordId: number;
  DeedFileNo: string;
  DeedNo: string | null;
  DeedYear: number | null;
  DeedDate: string | null;
  DeedTypeId: number;
  DeedTypeName: string;
  TransactionType: string;
  TaskTypeId: number | null;
  TaskTypeName: string | null;
  OfficeId: number;
  OfficeName: string;
  ProjectId: number | null;
  ProjectName: string | null;
  MouzaId: number | null;
  MouzaName: string | null;
  JLNo: string | null;
  RsPlotNo: string | null;
  RsKhatianNo: string | null;
  RsDag?: string | null;
  LrDag?: string | null;
  RsKhatian?: string | null;
  LrKhatian?: string | null;
  PurchasedArea: number | null;
  AreaUnitName: string | null;
  ConsiderationAmount: number | null;
  MarketValue: number | null;
  StampDutyAmount: number | null;
  RegistrationFee?: number | null;
  SellerName: string | null;
  BuyerName: string | null;
  AssignedExecutiveName: string | null;
  OverallStatus: string;
  L1Status: string;
  L2Status: string;
  L1ReviewerName?: string | null;
  L2ApproverName?: string | null;
  TotalDocs: number;
  AcceptedDocs: number;
  PendingMandatoryDocs: number;
}

export interface LegalDocumentItem {
  DocumentId: number;
  DeedRecordId: number;
  DocTypeId: number;
  DocTypeName: string;
  DocCategory: string;
  VersionNo: number;
  FilePath: string | null;
  FileName: string | null;
  VerificationStatus: string;
  IsMandatory: boolean;
  IsWaived: boolean;
  WaiverReason: string | null;
  WaivedByName: string | null;
  IsNA: boolean;
  NAReason: string | null;
  RejectionReason: string | null;
  VerificationNotes: string | null;
  VerifiedByName: string | null;
  ResponsibleUserName: string | null;
  DueDate: string | null;
}

export interface LegalApprovalLogItem {
  LogId: number;
  DeedRecordId: number;
  Stage: string;
  Action: string;
  NewStatus: string | null;
  Comments: string | null;
  ActionByName: string;
  ActionAt: string;
}

export interface PendingQueueData {
  pendingDeeds: {
    DeedRecordId: number;
    DeedFileNo: string;
    DeedNo: string | null;
    OverallStatus: string;
    TargetCompletionDate: string | null;
    OfficeName: string;
    ProjectName: string | null;
    AssignedExecutiveName: string | null;
    AgeDays: number;
  }[];
  missingDocs: {
    DocumentId: number;
    DeedRecordId: number;
    DeedFileNo: string;
    DocTypeName: string;
    Category: string;
    VerificationStatus: string;
    DueDate: string | null;
    RejectionReason: string | null;
    ResponsibleUserName: string | null;
    ProjectName: string | null;
  }[];
  approvalQueue: {
    DeedRecordId: number;
    DeedFileNo: string;
    OverallStatus: string;
    L1Status: string;
    L2Status: string;
    DeedTypeName: string;
    OfficeName: string;
    ProjectName: string | null;
    WaitingDays: number;
  }[];
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

import {
  MOCK_SEARCHES,
  MOCK_DEEDS,
  MOCK_DEED_DOCUMENTS,
  MOCK_APPROVAL_LOGS,
  MOCK_PENDING_QUEUE,
} from "./legalMockData";

// Searches
export const getLegalSearches = async (): Promise<LegalSearchItem[]> => {
  try {
    const res = await fetchWithAuth(`${BASE}/searches`);
    const data = await handle<LegalSearchItem[]>(res);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const createLegalSearch = async (payload: Partial<LegalSearchItem>) => {
  return await handle<{ searchId: number; searchNumber: string; message: string }>(
    await fetchWithAuth(`${BASE}/searches`, json("POST", payload))
  );
};

export const recordSearchOutcome = async (
  searchId: number,
  payload: {
    ActualSearchDate?: string;
    SearchOutcome: string;
    OfficialReceiptRef?: string;
    ReceiptAmount?: number;
    SearchNotes?: string;
  }
) => {
  return await handle<{ message: string }>(
    await fetchWithAuth(`${BASE}/searches/${searchId}/outcome`, json("PUT", payload))
  );
};

// Deeds
export const getLegalDeeds = async (): Promise<LegalDeedSummary[]> => {
  try {
    const res = await fetchWithAuth(`${BASE}/deeds`);
    const data = await handle<LegalDeedSummary[]>(res);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const getLegalDeedDetails = async (
  deedId: number
): Promise<{
  deed: LegalDeedSummary;
  documents: LegalDocumentItem[];
  logs: LegalApprovalLogItem[];
}> => {
  return await handle(await fetchWithAuth(`${BASE}/deeds/${deedId}`));
};

export const createLegalDeed = async (payload: Record<string, unknown>) => {
  try {
    return await handle<{ deedRecordId: number; deedFileNo: string; message: string }>(
      await fetchWithAuth(`${BASE}/deeds`, json("POST", payload))
    );
  } catch {
    const newId = MOCK_DEEDS.length + 1;
    const fileNo = `DEED-${new Date().getFullYear()}-${String(newId).padStart(4, "0")}`;
    return { deedRecordId: newId, deedFileNo: fileNo, message: "Deed file created successfully (Demo Mode)" };
  }
};

// Verification & Workflow
export const verifyDocumentStatus = async (
  deedId: number,
  docId: number,
  payload: Record<string, unknown>
) => {
  try {
    return await handle<{ message: string }>(
      await fetchWithAuth(`${BASE}/deeds/${deedId}/documents/${docId}/verify`, json("PUT", payload))
    );
  } catch {
    return { message: "Document status updated (Demo Mode)" };
  }
};

export const submitDeedForL1 = async (deedId: number) => {
  try {
    return await handle<{ message: string }>(
      await fetchWithAuth(`${BASE}/deeds/${deedId}/submit-l1`, { method: "POST" })
    );
  } catch {
    return { message: "Submitted for L1 review (Demo Mode)" };
  }
};

export const actionDeedL1 = async (deedId: number, action: "Approve" | "Return", remarks?: string) => {
  try {
    return await handle<{ message: string }>(
      await fetchWithAuth(`${BASE}/deeds/${deedId}/l1-action`, json("POST", { action, remarks }))
    );
  } catch {
    return { message: `Deed L1 ${action}ed (Demo Mode)` };
  }
};

export const actionDeedL2 = async (deedId: number, action: "Approve" | "Return" | "Reject", remarks?: string) => {
  try {
    return await handle<{ message: string }>(
      await fetchWithAuth(`${BASE}/deeds/${deedId}/l2-action`, json("POST", { action, remarks }))
    );
  } catch {
    return { message: `Deed L2 ${action}ed (Demo Mode)` };
  }
};

// Pending Queue
export const getLegalPendingQueue = async (): Promise<PendingQueueData> => {
  const emptyQueue: PendingQueueData = { pendingDeeds: [], missingDocs: [], approvalQueue: [] };
  try {
    const res = await fetchWithAuth(`${BASE}/pending-queue`);
    const data = await handle<PendingQueueData>(res);
    return data && Array.isArray(data.pendingDeeds) ? data : emptyQueue;
  } catch {
    return emptyQueue;
  }
};
