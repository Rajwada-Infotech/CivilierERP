import { fetchWithAuth } from "@/lib/fetchWithAuth";

// API connections for Government Site Links (Admin → API Integration), and fetching from them (migration 628).
const BASE = "/api/legal/portal-api";

export type PortalAuthType = "None" | "Header" | "Bearer" | "Basic";
export interface PortalApiLink {
  LinkId: number; LinkLabel: string; ServiceType: string; Url: string; IsActive: boolean;
  IsEnabled?: boolean | null; Method?: "GET" | "POST" | null; UrlTemplate?: string | null; AuthType?: PortalAuthType | null;
  AuthHeader?: string | null; Username?: string | null; BodyTemplate?: string | null; HasSecret?: boolean; UpdatedAt?: string | null; UpdatedByName?: string | null;
}
export interface PortalApiSettings {
  IsEnabled: boolean; Method: "GET" | "POST"; UrlTemplate: string; AuthType: PortalAuthType; AuthHeader?: string; Username?: string; Secret?: string; BodyTemplate?: string;
}
export interface PortalResult { site?: string; status: number; ok: boolean; ms: number; truncated: boolean; data: unknown; text: string | null }
/** Land details the {placeholders} are filled from. */
export type PortalValues = Partial<Record<"district" | "mouza" | "jlNo" | "location" | "lat" | "lng" | "rsDag" | "lrDag" | "rsKhatian" | "lrKhatian" | "landCode" | "enquiryNo", string | number | null>>;

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getPortalApis = async () => handle<{ ready: boolean; placeholders: string[]; links: PortalApiLink[] }>(await fetchWithAuth(BASE));
export const savePortalApi = async (linkId: number, s: PortalApiSettings) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${linkId}`, json("PUT", s)));
export const testPortalApi = async (linkId: number, values: PortalValues) => handle<PortalResult>(await fetchWithAuth(`${BASE}/${linkId}/test`, json("POST", { values })));
export const getEnabledPortals = async () => handle<{ LinkId: number; LinkLabel: string; ServiceType: string }[]>(await fetchWithAuth(`${BASE}/enabled`));
export const fetchFromPortal = async (linkId: number, values: PortalValues) => handle<PortalResult>(await fetchWithAuth(`${BASE}/${linkId}/fetch`, json("POST", { values })));
