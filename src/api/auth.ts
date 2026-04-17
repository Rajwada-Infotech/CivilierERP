import api from "./axios.ts";

export const loginUser = async (email: string, password: string) => {
  const res = await api.post("/users/login", { email, password });
  return res.data;
};