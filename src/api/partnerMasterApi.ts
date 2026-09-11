import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/partner-master";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    /* ignore invalid JSON responses */
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// A Partner always has TWO ledgers — a Capital Account head (investments)
// and a Current Account head (drawings / day-to-day movements) — never
// just one. See backend/routes/partnerMaster.js for how the two
// AccountHeadMaster rows are linked (LHeadCode suffix convention) and
// paired back into this one shape.
export interface PartnerRecord {
  id: string; // the shared Partner Code — this Master's stable identity
  partnerName: string;
  partnerCode: string;
  status: boolean;
  capitalHeadId: number | null;
  currentHeadId: number | null;
  capitalGroupName: string | null;
  currentGroupName: string | null;
  createdAt?: string | null;
}

export interface PartnerGroupOption {
  id: number;
  label: string;
  code: string;
}

export interface PartnerCreatePayload {
  PartnerName: string;
  PartnerCode: string;
}

export interface PartnerUpdatePayload {
  PartnerName?: string;
  Status?: boolean;
}

export const getPartners = async (): Promise<PartnerRecord[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<PartnerRecord[]>(res);
};

// Informational only (for showing group names) — the Master itself never
// lets a group be picked; both are always created together.
export const getPartnerGroupOptions = async (): Promise<PartnerGroupOption[]> => {
  const res = await fetchWithAuth(`${BASE}/group-options`);
  return handleResponse<PartnerGroupOption[]>(res);
};

export const addPartner = async (payload: PartnerCreatePayload): Promise<PartnerRecord> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<PartnerRecord>(res);
};

export const updatePartner = async (
  partnerCode: string,
  payload: PartnerUpdatePayload,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${encodeURIComponent(partnerCode)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const deletePartner = async (partnerCode: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${encodeURIComponent(partnerCode)}`, { method: "DELETE" });
  return handleResponse(res);
};
