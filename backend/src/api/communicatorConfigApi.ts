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
