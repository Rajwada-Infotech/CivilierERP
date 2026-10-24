// Empty forms for a new agreement, a document and a document request; the legal-executive list; file helpers.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, FileImage, FileSpreadsheet, File as FileIcon } from "lucide-react";
import { API, USERS_API } from "./config";

export const EMPTY_AGR_FORM = {
  BookingId: "", LegalName: "", LegalAddress: "",
  PanNo: "", AadhaarNo: "", Notes: "", LegalExecutiveId: "",
};

export async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${USERS_API}/legal-executives`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.id), label: u.name }));
  } catch { return []; }
}

export const EMPTY_DOC_FORM = {
  DocumentType: "SaleAgreement", DocumentUrl: "", IssuedBy: "", Remarks: "",
};
export const EMPTY_DOC_REQUEST_FORM = {
  DocumentType: "IdentityProof", Label: "", IsMandatory: true,
};

export function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fetchDocAudit(docId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${API}/documents/${docId}/audit`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
