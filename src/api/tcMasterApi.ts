import api from "./axios";

const BASE_URL = "/api/tc-master";

export const getTCRecords = async () => {
  const res = await api.get(BASE_URL);
  return res.data;
};

export const addTCRecord = async (data: Record<string, unknown>) => {
  const res = await api.post(BASE_URL, data);
  return res.data;
};

export const updateTCRecord = async (
  id: string | number,
  data: Record<string, unknown>,
) => {
  const res = await api.put(`${BASE_URL}/${id}`, data);
  return res.data;
};

export const deleteTCRecord = async (id: string | number) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
};