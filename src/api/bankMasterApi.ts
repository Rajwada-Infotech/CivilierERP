import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/bank-master";

async function handleResponse(res: Response) {
  let data = null;

  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

export const getBanks = async () => {
  const res = await fetchWithAuth(BASE);
  return handleResponse(res);
};

export const addBank = async (data: any) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  });

  return handleResponse(res);
};

export const updateBank = async (id: number, data: any) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

  return handleResponse(res);
};

export const deleteBank = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
  });

  return handleResponse(res);
};
