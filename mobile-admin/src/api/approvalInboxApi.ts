// RN port of the fetch/type/action logic in src/pages/admin/ApprovalInbox.tsx
// (web) — same endpoint (GET /api/approval-inbox), same InboxItem shape,
// same approve/reject contract (PUT ${endpoint}/${recordId}[/suffix]/${action}).
// Module metadata (icon/color/label/endpoint) lives in approvalInboxConfig.tsx
// since it needs lucide-react-native components, not plain data.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface InboxItem {
  Module: string;
  ModuleLabel: string;
  RecordId: string;
  Reference: string | null;
  RecordDate: string | null;
  Status: string;
  ContractorName: string | null;
  SupplierName: string | null;
  Amount: number | null;
  CreatedBy: string | null;
  ApprovedBy: string | null;
  ApprovedAt: string | null;
  RejectedBy: string | null;
  RejectionNote: string | null;
  LastModified: string | null;
  GrnTotalAmount: number | null;
  GrnBasicAmount: number | null;
  BillingTermsData: string | null;
  SourceTransferDocNo: string | null;
  FromGodownName: string | null;
  ToGodownName: string | null;
}

export const fetchInbox = async (): Promise<InboxItem[]> => {
  const res = await fetchWithAuth("/api/approval-inbox");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to fetch approval inbox");
  }
  return res.json().catch(() => []);
};

export const fetchRecordDetail = async (endpoint: string, recordId: string): Promise<Record<string, unknown> | null> => {
  const res = await fetchWithAuth(`${endpoint}/${recordId}`);
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json().catch(() => null);
  return data && typeof data === "object" ? data : null;
};

export const runApprovalAction = async (
  endpoint: string,
  recordId: string,
  action: "approve" | "reject",
  opts?: { note?: string; actionPathSuffix?: string },
) => {
  const path = opts?.actionPathSuffix
    ? `${endpoint}/${recordId}/${opts.actionPathSuffix}/${action}`
    : `${endpoint}/${recordId}/${action}`;
  const res = await fetchWithAuth(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: action === "reject" ? JSON.stringify({ note: opts?.note ?? "" }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
};
