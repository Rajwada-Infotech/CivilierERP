import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const getCommunicatorConfig = async <TConfig = Record<string, unknown>>(
  channel: string,
): Promise<TConfig> => {
  const res = await fetchWithAuth(`/api/communicator/${channel}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load communicator config");
  }

  const data = await res.json().catch(() => ({}));
  return (data?.config ?? {}) as TConfig;
};

export const saveCommunicatorConfig = async (
  channel: string,
  config: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`/api/communicator/${channel}`, {
    method: "PUT",
    body: JSON.stringify({ config }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to save communicator config");
  }

  return res.json().catch(() => ({}));
};

export type MessagingChannel = "email" | "sms" | "whatsapp";

export interface MessagingStatus {
  channel: MessagingChannel;
  saved: boolean;
  active: boolean;
  missing: string[];
  provider: string;
  from: string;
  updatedAt: string | null;
}

export const getMessagingStatus = async (): Promise<MessagingStatus[]> => {
  const res = await fetchWithAuth("/api/communicator/messaging/status");
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load messaging status");
  }
  const data = await res.json().catch(() => ({}));
  return data?.channels ?? [];
};

/** Sends one test message; resolves on delivery to the provider, throws with the provider's reason otherwise. */
export const sendMessagingTest = async (channel: MessagingChannel, to: string) => {
  const res = await fetchWithAuth(`/api/communicator/messaging/${channel}/test`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Test failed");
  return data;
};
