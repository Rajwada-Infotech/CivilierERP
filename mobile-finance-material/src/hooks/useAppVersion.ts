// Direct port of src/hooks/useAppVersion.ts (web) — same endpoint, same
// shape, only the fetchWithAuth import path changes.
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/services/fetchWithAuth";

interface AppVersionData {
  dbVersion: string;
  appVersion: string | null;
  releasedAt: string | null;
}

async function fetchAppVersion(): Promise<AppVersionData> {
  const res = await fetchWithAuth("/api/app-version");
  if (!res.ok) throw new Error("Failed to fetch app version");
  return res.json().catch(() => ({}));
}

export function useAppVersion() {
  const { data, isLoading } = useQuery<AppVersionData>({
    queryKey: ["app-version"],
    queryFn: fetchAppVersion,
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    dbVersion: data?.dbVersion ?? "…",
    appVersion: data?.appVersion ?? "…",
    releasedAt: data?.releasedAt ?? null,
    isLoading,
  };
}
