// src/hooks/useAppVersion.ts
// Fetches the current app version from the backend (dbo.Version table).
// Cached for 10 minutes — version rarely changes during a session.

import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface AppVersionData {
  version: string;
  releasedAt: string | null;
}

async function fetchAppVersion(): Promise<AppVersionData> {
  const res = await fetchWithAuth("/api/app-version");
  if (!res.ok) throw new Error("Failed to fetch app version");
  return res.json();
}

export function useAppVersion() {
  const { data, isLoading } = useQuery<AppVersionData>({
    queryKey: ["app-version"],
    queryFn: fetchAppVersion,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 10 * 60 * 1000,
  });

  return {
    version: data?.version ?? "…",
    releasedAt: data?.releasedAt ?? null,
    isLoading,
  };
}
