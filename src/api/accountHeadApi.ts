import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/account-head";

export const getList = async (type?: string) => {
  const url = type ? `${BASE_URL}?type=${encodeURIComponent(type)}` : BASE_URL;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addRecord = async (
  data: Record<string, unknown>,
  type: string,
) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, LHeadType: type }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateRecord = async (
  id: number,
  data: Record<string, unknown>,
  type: string,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, LHeadType: type }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deleteRecord = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};

export const getOptions = async (type?: string) => {
  const url = type
    ? `${BASE_URL}/options?type=${encodeURIComponent(type)}`
    : `${BASE_URL}/options`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Options GET failed: ${res.status}`);
  return res.json();
};

export interface AccountGroup {
  AGId: number;
  Name: string;
  ParentGroupId: number | null;
}

export const getAccountGroups = async (): Promise<AccountGroup[]> => {
  const res = await fetchWithAuth("/api/account-group");
  if (!res.ok) throw new Error(`Account Groups GET failed: ${res.status}`);
  return res.json();
};
