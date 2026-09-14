import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface DepartmentOption {
  Id: number;
  DepartmentName: string;
  IsActive: boolean;
}

export const getDepartmentOptions = async (): Promise<DepartmentOption[]> => {
  const res = await fetchWithAuth("/api/department-master");
  if (!res.ok) throw new Error("Failed to fetch departments");
  return res.json().catch(() => ([]));
};
