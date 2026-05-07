import api from "./axios";

export interface BillingTermRow {

  BillingTermID: number;       // exact DB column name
  Name: string | null;
  Description: string | null;
  CalculationType: string | null;
  DeductionType: string | null;
  IsActive: boolean | number;
}

export interface BillingTermPayload {
  Name: unknown;
  Description: unknown;
  CalculationType: string;
  DeductionType: string | null;
  IsActive: unknown;
}

export const getBillingTerms = async (): Promise<BillingTermRow[]> => {
  const { data } = await api.get("/api/billing-terms");

  return data;
};

export const addBillingTerm = async (
  payload: BillingTermPayload,
): Promise<void> => {
  await api.post("/billing-terms", payload);
};

export const updateBillingTerm = async (
  id: number,
  payload: BillingTermPayload,
): Promise<void> => {
  await api.put(`/billing-terms/${id}`, payload);
};

export const deleteBillingTerm = async (id: number): Promise<void> => {
  await api.delete(`/billing-terms/${id}`);
};
