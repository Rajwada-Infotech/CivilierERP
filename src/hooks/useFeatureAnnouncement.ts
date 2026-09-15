// src/hooks/useFeatureAnnouncement.ts
// Fetches the current "New: X just launched" badge text from the backend
// (dbo.FeatureAnnouncement) — the badge is null once it's past the
// server's auto-hide window, so the Login page just doesn't render it
// rather than needing to know about the expiry itself.

import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface FeatureAnnouncementData {
  title: string | null;
  launchedAt: string | null;
}

async function fetchFeatureAnnouncement(): Promise<FeatureAnnouncementData> {
  const res = await fetchWithAuth("/api/feature-announcement");
  if (!res.ok) throw new Error("Failed to fetch feature announcement");
  return res.json().catch(() => ({ title: null, launchedAt: null }));
}

export function useFeatureAnnouncement() {
  const { data, isLoading } = useQuery<FeatureAnnouncementData>({
    queryKey: ["feature-announcement"],
    queryFn: fetchFeatureAnnouncement,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 10 * 60 * 1000,
  });

  return {
    title: data?.title ?? null,
    launchedAt: data?.launchedAt ?? null,
    isLoading,
  };
}
