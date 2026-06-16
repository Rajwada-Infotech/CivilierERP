import api from "./axios";

const BASE_URL = "/item-groups";

export const getItemGroups = async () => {
  const res = await api.get(BASE_URL);
  return res.data;
};

export const addItemGroup = async (data: Record<string, unknown>) => {
  const res = await api.post(BASE_URL, data);
  return res.data;
};

export const updateItemGroup = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await api.put(`${BASE_URL}/${id}`, data);
  return res.data;
};

export const deleteItemGroup = async (id: string) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
};