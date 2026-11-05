import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface RankedModule {
  module: string;
  visits: number;
  lastVisitedAt: string | null;
  score: number;
}

export interface ModuleRanking {
  personalized: boolean;
  modules: RankedModule[];
}

export async function getModuleRanking(modules: string[]): Promise<ModuleRanking> {
  const qs = new URLSearchParams({ modules: modules.join(",") });
  const res = await fetchWithAuth(`/api/home/module-ranking?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to load module ranking");
  return res.json();
}

export async function recordModuleVisit(module: string): Promise<void> {
  // Bookkeeping for the home page's module ranking, not a change anyone made: kept out of the activity log
  // (it was logged as a "create" on every module opened, swamping each person's real changes).
  await fetchWithAuth("/api/home/usage", {
    method: "POST",
    skipActivityLog: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module }),
  });
}
