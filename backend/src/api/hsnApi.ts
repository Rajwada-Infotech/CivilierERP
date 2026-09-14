import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/hsn";

export const getHsn = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export interface HsnRow {
  HId: number;
  HCode: string;
  HDescription: string | null;
  HShortDescription: string | null;
  HStatus: boolean;
  HIsSAC: boolean;
}

/** Active SAC-code rows from the HSN master (Material → Setup → HSN, with the
 *  "Is SAC Code" toggle on). Used by the Fixed Asset "Type of Repairs SAC
 *  Code" picker. */
export const getSacCodes = async (): Promise<HsnRow[]> => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  const rows = (await res.json().catch(() => [])) as HsnRow[];
  return Array.isArray(rows)
    ? rows.filter((r) => r.HIsSAC && r.HStatus !== false)
    : [];
};

export const addHsn = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "POST failed");
  }
  return res.json().catch(() => ({}));
};

// HCode is deliberately not unique — the same HSN code can legitimately
// cover multiple product descriptions. `id` here is the row's HId
// (identity PK), not the HSN code — see migration 304.
export const updateHsn = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "PUT failed");
  }
  return res.json().catch(() => ({}));
};

export const deleteHsn = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "DELETE failed");
  }
  return res.json().catch(() => ({}));
};
