import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface DocSearchResult {
  /** DocNumberSequence.TableName — also the grouping key. */
  table: string;
  /** Human label of the document type, e.g. "Journal Voucher". */
  type: string;
  id: number;
  docNo: string;
  date: string | null;
  amount: number | null;
  status: string | null;
  subtitle: string | null;
  route: string;
  pageKey: string;
  /** List page + ?view=<id>; that page opens its own detail modal. */
  url: string;
  /** The typed text equals this document's number. */
  exact: boolean;
}

export interface DocSearchResponse {
  query: string;
  tooShort: boolean;
  results: DocSearchResult[];
}

export const DOC_SEARCH_MIN_LEN = 3;

export async function searchDocuments(q: string, signal?: AbortSignal): Promise<DocSearchResponse> {
  const res = await fetchWithAuth(`/api/doc-search?q=${encodeURIComponent(q)}`, { signal, skipActivityLog: true });
  if (!res.ok) throw new Error("Document search failed");
  return res.json();
}
