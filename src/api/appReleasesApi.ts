import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/app-releases";

export interface AppRelease {
  id: number;
  appKey: string;
  packageName: string;
  versionCode: number;
  versionName: string | null;
  sizeBytes: number;
  sha256: string;
  md5: string;
  releaseNotes: string | null;
  mandatory: boolean;
  isCurrent: boolean;
  publishedBy: string | null;
  publishedAt: string;
  downloadPath: string;
}

export interface AppCatalogEntry {
  appKey: string;
  label: string;
  packageName: string;
  current: AppRelease | null;
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body as T;
}

export const getAppCatalog = () => fetchWithAuth(`${BASE}/catalog`).then((r) => handle<AppCatalogEntry[]>(r));

export const getAppReleases = (appKey?: string) =>
  fetchWithAuth(appKey ? `${BASE}?app=${encodeURIComponent(appKey)}` : BASE).then((r) => handle<AppRelease[]>(r));

export const publishAppRelease = (input: { appKey: string; file: File; releaseNotes: string; mandatory: boolean }) => {
  const form = new FormData();
  form.append("appKey", input.appKey);
  form.append("releaseNotes", input.releaseNotes);
  form.append("mandatory", input.mandatory ? "true" : "false");
  form.append("file", input.file);
  return fetchWithAuth(BASE, { method: "POST", body: form }).then((r) => handle<AppRelease>(r));
};

export const updateAppRelease = (id: number, input: { releaseNotes: string; mandatory: boolean }) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((r) => handle<AppRelease>(r));
