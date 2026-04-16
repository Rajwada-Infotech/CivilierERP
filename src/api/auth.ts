import api from "./axios";

export const login = async (email: string, password: string) => {
  const res = await api.post("/users/login", { email, password });
  return res.data;
};