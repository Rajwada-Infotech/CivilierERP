import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/document-registry";

export interface GenerateDocumentPayload {
  companyId: number | string;
  projectId: number | string;
  docTypeId: number | string;
  financialYear: string;
  transactionTable: string; // The source module, e.g., 'payments', 'purchase_orders'
}

export interface DocumentRegistryResponse {
  id: number;
  full_doc_number: string;
  running_sequence: number;
}

export const generateDocumentNumber = async (
  payload: GenerateDocumentPayload
): Promise<DocumentRegistryResponse> => {
  const res = await fetchWithAuth(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to generate document number");
  return res.json().catch(() => ({}));
};