const BASE_URL = "/api/users";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_datetime: string;
  discontinue: boolean;
}

export const loginUser = async (email: string, password: string) => {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json(); // returns { success, token, user }

};

export const getUsers = async (): Promise<User[]> => {
  const res = await fetch(BASE_URL, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
};

export const addUser = async (user: { name: string; email: string; role: string; password: string }) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Failed to add user");
  return res.json();
};

export const updateUser = async (id: number, user: Partial<User>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Failed to update user");
  return res.json();
};

export const deleteUser = async (id: number) => {
  const res = await fetch(`${BASE_URL}/${id}`, { method: "DELETE", headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to delete user");
  return res.json();
};