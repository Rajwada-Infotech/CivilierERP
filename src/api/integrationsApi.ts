import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { apiUrl } from "@/lib/apiBase";

const errorOf = async (res: Response, fallback: string) => {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
};

// ─── Social media connections (dbo.IntegrationChannels) ─────────────────────

export interface IntegrationConnection {
  Id: number;
  ChannelKey: string;
  Label: string;
  Description: string | null;
  IsActive: boolean;
  Provider: string | null;
  TokenExpiresAt: string | null;
  LastTestAt: string | null;
  LastTestOk: boolean | null;
  LastTestMessage: string | null;
  HasAccessToken: number;
  HasRefreshToken: number;
  /** The provider's plain settings (e.g. OAuth client ID); secret ones only appear in SavedSecrets. */
  Settings: Record<string, string>;
  SavedSecrets: string[];
  /** Instant Meta lead-form leads. */
  WebhookOnAt: string | null;
  LastWebhookAt: string | null;
  LastWebhookOk: boolean | null;
  LastWebhookMessage: string | null;
  WebhookLeads: number;
  UsedBy: string[];
}

export interface ProviderSetting { key: string; label: string; secret: boolean }
/** settings: extra values this provider's connection needs; autoRenew: the access token renews itself from the refresh token. */
export interface ConnectionProvider { id: string; label: string; settings: ProviderSetting[]; autoRenew: boolean; instantLeads: boolean }

/** Rejects with status 403 when the viewer isn't allowed to manage connections. */
export const getConnections = async (): Promise<{ channels: IntegrationConnection[]; providers: ConnectionProvider[] }> => {
  const res = await fetchWithAuth("/api/communicator/channels");
  if (!res.ok) throw Object.assign(await errorOf(res, "Could not read the connections"), { status: res.status });
  const body = await res.json().catch(() => ({}));
  return { channels: body.channels ?? [], providers: body.providers ?? [] };
};

export interface ConnectionCredentials {
  provider: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string | null;
  settings?: Record<string, string>;
}

export const saveConnectionCredentials = async (id: number, body: ConnectionCredentials) => {
  const res = await fetchWithAuth(`/api/communicator/channels/${id}/credentials`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw await errorOf(res, "Could not save the connection");
  return res.json().catch(() => ({}));
};

/** Where Meta / Google send people back after "Connect" — to be added to the Google OAuth client / Meta app. */
export const oauthRedirectUri = () => new URL(apiUrl("/api/public/integrations/oauth/callback"), window.location.origin).href;
/** Where Meta delivers a connection's lead-form leads. */
export const metaLeadsUrl = (id: number) => new URL(apiUrl(`/api/public/integrations/meta-leads/${id}`), window.location.origin).href;

/** The provider's sign-in address for "Connect"; the browser goes there. */
export const startConnect = async (id: number): Promise<string> => {
  const returnTo = new URL("/admin/api-integration", window.location.origin).href;
  const res = await fetchWithAuth(`/api/communicator/channels/${id}/oauth/start`, {
    method: "POST", body: JSON.stringify({ redirectUri: oauthRedirectUri(), returnTo }),
  });
  if (!res.ok) throw await errorOf(res, "Could not start the sign-in");
  return (await res.json()).url;
};

export const turnOnInstantLeads = async (id: number): Promise<{ pages: { id: string; name: string; ok: boolean; error?: string }[] }> => {
  const res = await fetchWithAuth(`/api/communicator/channels/${id}/instant-leads`, {
    method: "POST", body: JSON.stringify({ callbackUrl: metaLeadsUrl(id) }),
  });
  if (!res.ok) throw await errorOf(res, "Could not switch on instant leads");
  return res.json();
};

export const testConnection = async (id: number): Promise<{ ok: boolean; message: string }> => {
  const res = await fetchWithAuth(`/api/communicator/channels/${id}/test`, { method: "POST" });
  if (!res.ok) throw await errorOf(res, "Connection test failed to run");
  return res.json();
};

// ─── Channel partner API keys ───────────────────────────────────────────────

const KEYS_API = "/api/integrations/partner-keys";

export interface PartnerApiKey {
  Id: number;
  ChannelPartnerId: number;
  PartnerName: string;
  PartnerCode: string | null;
  Label: string | null;
  KeyPrefix: string;
  IsActive: boolean;
  LastUsedAt: string | null;
  LeadsReceived: number;
  CreatedAt: string;
  RevokedAt: string | null;
  CreatedByName: string | null;
  RevokedByName: string | null;
}

export interface PartnerOption { Id: number; Name: string; PartnerCode: string | null }

/** How the partner endpoint behaves — from the server, so the help text can't drift from it. */
export interface PartnerApiRules { fields: string[]; required: string[]; maxBatch: number; requestsPerMinute: number }

export const getPartnerKeys = async (): Promise<{ keys: PartnerApiKey[]; partners: PartnerOption[]; api: PartnerApiRules }> => {
  const res = await fetchWithAuth(KEYS_API);
  if (!res.ok) throw await errorOf(res, "Could not read the partner keys");
  return res.json();
};

/** Resolves with the new key — the only time it is ever shown. */
export const createPartnerKey = async (channelPartnerId: number, label: string): Promise<{ key: string; partnerName: string }> => {
  const res = await fetchWithAuth(KEYS_API, { method: "POST", body: JSON.stringify({ channelPartnerId, label }) });
  if (!res.ok) throw await errorOf(res, "Could not make the key");
  return res.json();
};

export const revokePartnerKey = async (id: number) => {
  const res = await fetchWithAuth(`${KEYS_API}/${id}/revoke`, { method: "POST" });
  if (!res.ok) throw await errorOf(res, "Could not revoke the key");
};
