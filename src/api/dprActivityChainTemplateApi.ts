import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dpr-activity-chain-template";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface ChainTemplateSummary {
  templateId: number | null;
  roomCategoryId: number;
  roomCategoryAlias: string;
  sortOrder: number;
  itemCount: number;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface ChainTemplateItem {
  Id: number;
  SequenceNo: number;
  ActivityId: number;
  activityName: string;
}

export interface GenerateResult {
  message: string;
  generated: number;
  skippedExisting: number;
  skippedNoTemplate: number;
  totalRoomsInScope: number;
}

export const getChainTemplates = async (): Promise<ChainTemplateSummary[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<ChainTemplateSummary[]>(res);
};

export const getChainTemplateItems = async (roomCategoryId: number): Promise<{ items: ChainTemplateItem[] }> => {
  const res = await fetchWithAuth(`${BASE}/${roomCategoryId}`);
  return handleResponse(res);
};

export const saveChainTemplate = async (
  roomCategoryId: number,
  activityIds: number[],
): Promise<{ message: string; templateId: number; itemCount: number }> => {
  const res = await fetchWithAuth(`${BASE}/${roomCategoryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ActivityIds: activityIds }),
  });
  return handleResponse(res);
};

export const deleteChainTemplate = async (roomCategoryId: number): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${roomCategoryId}`, { method: "DELETE" });
  return handleResponse(res);
};

export const generateChains = async (
  projectId: number,
  blockId: number | null,
  workType: "INTERNAL" | "EXTERNAL",
): Promise<GenerateResult> => {
  const res = await fetchWithAuth(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ProjectId: projectId, BlockId: blockId, WorkType: workType }),
  });
  return handleResponse(res);
};
