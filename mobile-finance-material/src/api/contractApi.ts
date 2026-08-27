// RN port of src/api/contractApi.ts — same endpoints/types, including
// create/update and image attachments (via expo-image-picker's base64
// option — expo-file-system isn't installed, so this covers photos of a
// paper contract but not arbitrary PDFs/docs the way web's file input does).
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/contract";

export interface ContractListItem {
  ContractId: number;
  DocNo: string | null;
  DocDate: string | null;
  ContractDate: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  FinYear: string | null;
  ContactPerson: string | null;
  NatureOfContract: string | null;
  ContractAmount: number | null;
  ContractStartDate: string | null;
  ContractEndDate: string | null;
  Status: string;
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface PartyPill {
  type: "Supplier" | "Contractor" | "Applicant";
  id: number;
  name: string;
}

export interface ContractDetail extends ContractListItem {
  Reason: string | null;
  Attachments: string | null;
  TermsAndConditions: string | null;
  Remarks: string | null;
  Parties: string | null;
}

export interface ContractLedgerEntry {
  LedgerId: number;
  TxnType: "Advance" | "Adjustment" | "Refund";
  Amount: number;
  SourceType: string;
  SourceId: number;
  SourceDocNo: string | null;
  Remarks: string | null;
  CreatedAt: string;
}

export interface ContractSummary {
  ContractValue: number;
  TotalAdvance: number;
  TotalAllocated: number;
  UnallocatedBalance: number;
  TotalDocumented: number;
  RemainingContractValue: number;
  OverBilled: boolean;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export async function getContracts(): Promise<ContractListItem[]> {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) await handleError(res, "Failed to fetch contracts");
  const raw = await res.json();
  return Array.isArray(raw) ? raw.filter((c: ContractListItem) => c.Status !== "Deleted") : [];
}

// Extra fields the list endpoint returns beyond ContractListItem, used by
// PaymentFormModal's Contract-link picker (mirrors Payment.tsx's
// contractOptions query — status=Approved, plus ContactPartyId/Reason/
// PendingAmount for prefill).
export interface ContractLinkOption extends ContractListItem {
  ContactPartyId: number | null;
  Reason: string | null;
  PendingAmount: number | null;
}

export async function getApprovedContractsForLinking(): Promise<ContractLinkOption[]> {
  const res = await fetchWithAuth(`${BASE}?status=Approved`);
  if (!res.ok) return [];
  const raw = await res.json().catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

export async function getContract(id: number): Promise<ContractDetail> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch contract");
  return res.json();
}

export async function getContractLedger(id: number): Promise<{ summary: ContractSummary; ledger: ContractLedgerEntry[] }> {
  const res = await fetchWithAuth(`${BASE}/${id}/ledger`);
  if (!res.ok) await handleError(res, "Failed to fetch contract ledger");
  return res.json();
}

// ── New Contract form ───────────────────────────────────────────────────────

export interface ContractPayload {
  docTypeId: number;
  docDate?: string;
  contractDate?: string;
  companyId?: number | null;
  projectId?: number | null;
  finYear?: string;
  contactPerson?: string;
  contactPartyId?: number | null;
  reason?: string;
  natureOfContract?: string;
  contractAmount?: number | null;
  contractStartDate?: string;
  contractEndDate?: string;
  attachments?: Attachment[];
  termsAndConditions?: string;
  remarks?: string;
  parties?: PartyPill[];
}

export async function createContract(data: ContractPayload): Promise<{ contractId: number; docNo: string }> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create contract");
  return res.json();
}

export async function updateContract(id: number, data: Partial<ContractPayload> & { status?: string }): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update contract");
}

export async function deleteContract(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete contract");
}

// RN port of DocNumberPreview.tsx's standalone fetch helpers.
export interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string | null;
  DocNoPrefix: string | null;
  Description: string;
}

export async function fetchDocTypes(module: string): Promise<DocType[]> {
  const res = await fetchWithAuth(`/api/document-type?module=${encodeURIComponent(module)}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchNextDocNumber(docTypeId: number, finYear?: string): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`/api/document-type/${docTypeId}/next-number${qs}`);
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.nextDocNo ?? "";
}

export interface ContactPerson {
  name: string;
  type: "S" | "C" | "A";
  partyId: number;
  partyName: string;
  partyCode: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst: string | null;
  pan: string | null;
}

export async function fetchContactPersons(): Promise<ContactPerson[]> {
  const res = await fetchWithAuth("/api/contract/contact-persons");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export interface TCRecord {
  id: number;
  name: string;
  terms: string;
}

export async function fetchTCRecords(): Promise<TCRecord[]> {
  const res = await fetchWithAuth("/api/tc-master");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return rows
    .filter((t: any) => t.isActive !== false)
    .map((t: any) => ({
      id: t.Id ?? t.id ?? 0,
      name: t.Name ?? t.name ?? "",
      terms: t.TermsAndCondition ?? t.terms ?? "",
    }));
}
