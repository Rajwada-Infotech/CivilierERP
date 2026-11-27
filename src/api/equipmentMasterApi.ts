// Engineering → Setup → Equipment Master: machines and plant a BOQ can plan for. backend/routes/equipmentMaster.js.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type Ownership = "Owned" | "Hired";
export interface Equipment {
  id: number;
  name: string;
  code: string | null;
  /** Billing unit: Hour, Day, Month, Trip… */
  uom: string | null;
  /** Standard hire rate per unit — the default on a new BOQ line. */
  rate: number | null;
  ownership: Ownership;
  description: string | null;
  isActive: boolean;
  usedOnBoqs: number;
}
export type EquipmentInput = Omit<Equipment, "id" | "usedOnBoqs">;

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The request failed (${res.status}).`);
  return body as T;
}

const BASE = "/api/equipment-master";
export const getEquipment = async (onlyActive = false) => read<Equipment[]>(await fetchWithAuth(onlyActive ? `${BASE}?active=1` : BASE));
export const addEquipment = async (e: EquipmentInput) =>
  read<Equipment>(await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) }));
export const updateEquipment = async (id: number, e: EquipmentInput) =>
  read<Equipment>(await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) }));
export const deleteEquipment = async (id: number) => read<{ success: true }>(await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }));
