import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/charge-head";

export interface ChargeHeadRow {
  Id: number;
  Name: string;
  Rate: number;
  TaxPct: number;
  HsnId: number | null;
  Status: boolean;
  HCode: string | null;
  HDescription: string | null;
  HIsSAC: boolean | null;
  CreatedBy: number | null;
  CreatedAt: string | null;
  UpdatedBy: number | null;
  UpdatedAt: string | null;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

export const getChargeHeads = (): Promise<ChargeHeadRow[]> =>
  fetchWithAuth(BASE).then((r) => r.json().catch(() => []));

export const addChargeHead = async (data: object) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to save Charge Head");
  return res.json().catch(() => ({}));
};

export const updateChargeHead = async (id: string, data: object) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to update Charge Head");
  return res.json().catch(() => ({}));
};

export const deleteChargeHead = async (id: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Failed to delete Charge Head");
  return res.json().catch(() => ({}));
};

// Active Charge Heads only — used by the Customer Maintenance Profile's
// "Add Charge" picker, which must never offer a retired Charge Head for new use.
export const getActiveChargeHeads = async (): Promise<ChargeHeadRow[]> => {
  const rows = await getChargeHeads();
  return rows.filter((r) => r.Status !== false);
};
