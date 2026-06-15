import api from "./axios";

const BASE_URL = "/api/entry-type";

export const getEntryTypes = async () => {
  const res = await api.get(BASE_URL);
  return res.data;
};

export const addEntryType = async (data: Record<string, unknown>) => {
  const res = await api.post(BASE_URL, data);
  return res.data;
};

export const updateEntryType = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await api.put(`${BASE_URL}/${id}`, data);
  return res.data;
};

export const deleteEntryType = async (id: string) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
};

export const getProjects = async () => {
  const res = await api.get(`${BASE_URL}/projects`);
  return res.data;
};