import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-depreciation-generate";

export type AssetMonthState = "posted" | "pending" | "notEligible";

export interface GenerateAssetRow {
  assetId: number;
  faItemCode: string;
  assetName: string | null;
  assetCategory: string | null;
  assetStatus: string;
  method: string | null;
  ratePct: number | null;
  purchaseCost: number | null;
  state: AssetMonthState;
  /** Depreciation for the month — posted amount, or what Generate will post. */
  amount?: number;
  closingBookValue?: number;
  voucherNo?: string | null;
  postedAt?: string | null;
  postedBy?: string | null;
  /** Why a notEligible asset isn't depreciated this month. */
  reason?: string;
}

export interface GeneratePreview {
  projectId: number;
  year: number;
  month: number;
  monthStatus: "Not generated" | "Partially generated" | "Generated";
  counts: { total: number; posted: number; pending: number; notEligible: number };
  rows: GenerateAssetRow[];
}

export type GenerateOutcome = "generated" | "alreadyPosted" | "skipped" | "failed";

export interface GenerateResultRow {
  assetId: number;
  faItemCode: string;
  outcome: GenerateOutcome;
  voucherNo?: string | null;
  amount?: number;
  closingBookValue?: number;
  message?: string;
}

export interface GenerateResult {
  ok: boolean;
  projectId: number;
  year: number;
  month: number;
  counts: { generated: number; alreadyPosted: number; skipped: number; failed: number };
  totalAmount: number;
  results: GenerateResultRow[];
}

export interface PostingHistoryRow {
  EntryId: number;
  PeriodYear: number;
  PeriodMonth: number;
  ProjectId: number | null;
  ProjectName: string | null;
  FAItemCode: string | null;
  AssetName: string | null;
  DepreciationAmount: number;
  AccumulatedDepreciation: number;
  ClosingBookValue: number;
  PostedAt: string;
  PostedBy: string | null;
  VoucherNo: string | null;
  PostingStatus: "Posted" | "Reversed";
}

export interface GenerateRunRow {
  RunId: number;
  PeriodYear: number;
  PeriodMonth: number;
  TriggerType: string;
  StartedAt: string;
  RunBy: string | null;
  Generated: number;
  AlreadyPosted: number;
  Skipped: number;
  Failed: number;
  TotalAmount: number;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

export const getGeneratePreview = async (projectId: number, year: number, month: number) =>
  parse<GeneratePreview>(await fetchWithAuth(`${BASE}/assets?projectId=${projectId}&year=${year}&month=${month}`), "Failed to load assets");

export const generateDepreciation = async (projectId: number, year: number, month: number) =>
  parse<GenerateResult>(
    await fetchWithAuth(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, year, month }),
    }),
    "Failed to generate depreciation",
  );

export const getPostingHistory = async (projectId: number, year?: number, month?: number) => {
  const qs = new URLSearchParams({ projectId: String(projectId) });
  if (year) qs.set("year", String(year));
  if (month) qs.set("month", String(month));
  return parse<PostingHistoryRow[]>(await fetchWithAuth(`${BASE}/history?${qs}`), "Failed to load posting history");
};

export const getGenerateRuns = async (projectId: number) =>
  parse<GenerateRunRow[]>(await fetchWithAuth(`${BASE}/runs?projectId=${projectId}`), "Failed to load generation log");
