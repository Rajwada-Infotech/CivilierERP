import api from "./axios";

const BASE_URL = "/item-master";

export interface DbItem {
  M_Id: string;
  M_Name: string;
  M_Description: string | null;
  M_Type: string | null;
  M_BelongsTo: string | null;
  M_Group: string | null;
  M_code: string | null;
  M_IdentityCode: boolean;
  M_HSN: string | null;
  M_CGST: number | null;
  M_IGST: number | null;
  M_SGST: number | null;
  M_UOM: string | null;
  M_CreatedBy: string | null;
  M_CreatedDate: string;
  M_ApprovedBy: string | null;
  Parent_Id: string;
  ParentGroupName: string | null;
  default_supplier_id: number | null;
  DefaultSupplierName: string | null;
}

export const getItems = async (): Promise<DbItem[]> => {
  const res = await api.get<DbItem[]>(BASE_URL);
  return res.data;
};

export const addItem = async (data: Record<string, unknown>) => {
  const res = await api.post(BASE_URL, data);
  return res.data;
};

export const updateItem = async (id: string, data: Record<string, unknown>) => {
  const res = await api.put(`${BASE_URL}/${id}`, data);
  return res.data;
};

export const deleteItem = async (id: string) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
};