import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/salary-structure";

export interface SalaryStructureLineRow {
  LineId: number;
  SalaryStructureId: number;
  DeductionAdditionId: number;
  Percentage: number | null;
  Amount: number | null;
  HeadName: string;
  HeadCode: string;
  HeadType: "Deduction" | "Addition";
}

export interface SalaryStructureRow {
  SalaryStructureId: number;
  CompanyId: number | null;
  CompanyName: string | null;
  Name: string;
  Code: string;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
  Lines: SalaryStructureLineRow[];
}

export interface SalaryStructureLinePayload {
  DeductionAdditionId: number;
  Percentage: number | null;
  Amount: number | null;
}

export interface SalaryStructurePayload {
  CompanyId: number | null;
  Name: string;
  Code: string;
  IsActive?: boolean;
  Lines: SalaryStructureLinePayload[];
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getSalaryStructures = async (): Promise<SalaryStructureRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addSalaryStructure = async (payload: SalaryStructurePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; id: number }>(res);
};

export const updateSalaryStructure = async (id: number, payload: SalaryStructurePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteSalaryStructure = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
