import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/account-group";

export interface AccountGroupUsage {
  label: string;
  count: number;
  path: string;
}

export class AccountGroupDeleteError extends Error {
  code?: string;
  linkedType?: string;
  linkedName?: string;
  usedIn?: AccountGroupUsage[];

  constructor(message: string, body: Record<string, unknown>) {
    super(message);
    this.code = body.code as string | undefined;
    this.linkedType = body.linkedType as string | undefined;
    this.linkedName = body.linkedName as string | undefined;
    this.usedIn = body.usedIn as AccountGroupUsage[] | undefined;
  }
}

export const getAccountGroups = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error("Couldn't load account groups. Please try again.");
  return res.json().catch(() => ({}));
};

export const addAccountGroup = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Couldn't create this account group. Please try again.");
  }
  return res.json().catch(() => ({}));
};

export const updateAccountGroup = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Couldn't update this account group. Please try again.");
  }
  return res.json().catch(() => ({}));
};

export const deleteAccountGroup = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AccountGroupDeleteError(
      err.error || "Couldn't delete this account group. Please try again.",
      err,
    );
  }
  return res.json().catch(() => ({}));
};
