import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type ChainDocType = "mr" | "po" | "grn" | "expense";

export interface ChainNode {
  docType: ChainDocType;
  id: number;
  docNo: string | null;
  date: string | null;
  status: string | null;
  label: string;
  extra: Record<string, any>;
}

export interface ChainResponse {
  current: ChainNode;
  upstream: ChainNode[];
  downstream: ChainNode[];
}

export const getDocumentChain = async (
  type: ChainDocType,
  id: number,
): Promise<ChainResponse> => {
  const res = await fetchWithAuth(`/api/material-chain/${type}/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// Each doc type's list page and the query param it watches for deep-linking.
export const CHAIN_ROUTES: Record<ChainDocType, string> = {
  mr: "/material/material-request",
  po: "/material/purchase-order",
  grn: "/material/grn",
  expense: "/material/expense-booking",
};
