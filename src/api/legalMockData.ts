import { LegalSearchItem, LegalDeedSummary, LegalDocumentItem, LegalApprovalLogItem, PendingQueueData } from "./legalOperationsApi";
import { LegalOption } from "./legalMastersApi";

export const MOCK_LEGAL_OPTIONS: Record<string, LegalOption[]> = {
  "registration-office": [],
  "portal-link": [],
  "mouza": [],
  "rs-plot": [],
  "rs-khatian": [],
  "lr-ror": [],
  "area-unit": [],
  "deed-type": [],
  "project": [],
  "party": [],
  "user": [],
};

export const MOCK_SEARCHES: LegalSearchItem[] = [];

export const MOCK_DEEDS: LegalDeedSummary[] = [];

export const MOCK_DEED_DOCUMENTS: LegalDocumentItem[] = [];

export const MOCK_APPROVAL_LOGS: LegalApprovalLogItem[] = [];

export const MOCK_PENDING_QUEUE: PendingQueueData = {
  pendingDeeds: [],
  missingDocs: [],
  approvalQueue: [],
};
