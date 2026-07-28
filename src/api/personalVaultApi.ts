import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/personal-vault";

export interface PersonalVaultFolder {
  FolderName: string;
  FileCount: number;
  TotalSize: number;
  LatestUploadedAt: string;
  HasPassword: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getPersonalVaultFolders = async (): Promise<PersonalVaultFolder[]> => {
  const res = await fetchWithAuth(`${BASE}/folders`);
  return handle(res);
};

export const uploadToPersonalVault = async (folderName: string, files: File[], password?: string) => {
  const form = new FormData();
  form.append("folderName", folderName);
  if (password) form.append("password", password);
  files.forEach((f) => form.append("file", f));
  const res = await fetchWithAuth(`${BASE}/upload`, { method: "POST", body: form });
  return handle(res);
};

/** Files (add-more) into an already-existing, unlocked-if-protected folder. */
export const uploadMoreToPersonalVault = async (folderName: string, files: File[], vaultToken?: string | null) => {
  const form = new FormData();
  form.append("folderName", folderName);
  files.forEach((f) => form.append("file", f));
  const res = await fetchWithAuth(`${BASE}/upload`, {
    method: "POST",
    body: form,
    headers: vaultToken ? { "X-Vault-Token": vaultToken } : undefined,
  });
  return handle(res);
};

export const unlockPersonalVaultFolder = async (folderName: string, password: string): Promise<{ token: string }> => {
  const res = await fetchWithAuth(`${BASE}/folder/${encodeURIComponent(folderName)}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return handle(res);
};

export const setPersonalVaultFolderPassword = async (
  folderName: string,
  newPassword: string | null,
  vaultToken?: string | null,
): Promise<{ token: string | null }> => {
  const res = await fetchWithAuth(`${BASE}/folder/${encodeURIComponent(folderName)}/set-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(vaultToken ? { "X-Vault-Token": vaultToken } : {}),
    },
    body: JSON.stringify({ newPassword }),
  });
  return handle(res);
};

export const resetPersonalVaultFolderPassword = async (
  folderName: string,
  accountPassword: string,
  newPassword: string | null,
): Promise<{ token: string | null }> => {
  const res = await fetchWithAuth(`${BASE}/folder/${encodeURIComponent(folderName)}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountPassword, newPassword }),
  });
  return handle(res);
};

export const deletePersonalVaultFile = async (id: number, vaultToken?: string | null) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
    headers: vaultToken ? { "X-Vault-Token": vaultToken } : undefined,
  });
  return handle(res);
};

export const deletePersonalVaultFilesBulk = async (ids: number[], vaultToken?: string | null) => {
  const res = await fetchWithAuth(`${BASE}/bulk`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(vaultToken ? { "X-Vault-Token": vaultToken } : {}),
    },
    body: JSON.stringify({ ids }),
  });
  return handle(res);
};

export const deletePersonalVaultFolder = async (folderName: string, vaultToken?: string | null) => {
  const res = await fetchWithAuth(`${BASE}/folder/${encodeURIComponent(folderName)}`, {
    method: "DELETE",
    headers: vaultToken ? { "X-Vault-Token": vaultToken } : undefined,
  });
  return handle(res);
};

/** Streams a personal-vault file for preview/download, honoring the vault
 *  unlock token if the folder is protected — used instead of the plain
 *  fetchWithAuth(record.url) path Records.tsx uses for every other source. */
export const fetchPersonalVaultFile = async (url: string, vaultToken?: string | null) => {
  return fetchWithAuth(url, {
    headers: vaultToken ? { "X-Vault-Token": vaultToken } : undefined,
  });
};
