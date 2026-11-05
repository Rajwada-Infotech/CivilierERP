// Fixed Asset Depreciation Run (/api/fixed-asset-depreciation-generate) — the web "Depreciation Run" menu:
// preview a project's tagged assets for a month, generate one month, or run a custom month range in bulk.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/fixed-asset-depreciation-generate";

export type AssetMonthState = "posted" | "pending" | "notEligible";

export interface RunAssetRow {
  assetId: number;
  faItemCode: string;
  assetName: string | null;
  state: AssetMonthState;
  /** Depreciation for the month — posted amount, or what a run will post. */
  amount?: number;
  closingBookValue?: number;
  voucherNo?: string | null;
  reason?: string;
}

export interface RunPreview {
  projectId: number;
  year: number;
  month: number;
  monthStatus: "Not generated" | "Partially generated" | "Generated";
  counts: { total: number; posted: number; pending: number; notEligible: number };
  rows: RunAssetRow[];
}

export interface RunCounts { generated: number; alreadyPosted: number; skipped: number; failed: number }

export interface GenerateResult {
  ok: boolean;
  year: number;
  month: number;
  counts: RunCounts;
  totalAmount: number;
}

export interface RangeMonth {
  year: number;
  month: number;
  counts?: RunCounts;
  totalAmount?: number;
  error?: string;
}

export interface RangeResult {
  months: RangeMonth[];
  counts: RunCounts;
  totalAmount: number;
  stoppedAt: { year: number; month: number; message: string } | null;
}

async function call<T>(url: string, fallback: string, body?: unknown): Promise<T> {
  const res = await fetchWithAuth(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

export const getRunPreview = (projectId: number, year: number, month: number): Promise<RunPreview> =>
  call(`${BASE}/assets?projectId=${projectId}&year=${year}&month=${month}`, "Failed to load assets");

export const generateMonth = (projectId: number, year: number, month: number): Promise<GenerateResult> =>
  call(`${BASE}/generate`, "Failed to generate depreciation", { projectId, year, month });

/** Bulk run over a custom month range (inclusive), oldest month first. */
export const generateRange = (
  projectId: number,
  from: { year: number; month: number },
  to: { year: number; month: number },
): Promise<RangeResult> =>
  call(`${BASE}/generate-range`, "Failed to run depreciation for the range", {
    projectId, fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month,
  });
