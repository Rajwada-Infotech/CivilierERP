import api from "./axios.ts";

export const loginUser = async (email: string, password: string) => {
  try {
    const res = await api.post("/users/login", { email, password });
    return res.data;
  } catch (err: any) {
    // Re-throw with the backend's error message intact so AuthContext can read it
    const message =
      err.response?.data?.error ||
      err.response?.data?.message ||
      "Login failed. Please check your credentials.";
    const enriched = new Error(message) as any;
    enriched.response = err.response;
    throw enriched;
  }
};
