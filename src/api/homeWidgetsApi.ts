import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { WidgetMetricDef } from "@/api/widgetsApi";

export interface RankedModule {
  module: string;
  visits: number;
  lastVisitedAt: string | null;
  score: number;
}

export interface HomeWidgetsResponse {
  personalized: boolean;
  modules: RankedModule[];
  widgets: WidgetMetricDef[];
}

export async function getHomeWidgets(modules: string[]): Promise<HomeWidgetsResponse> {
  const qs = new URLSearchParams({ modules: modules.join(",") });
  const res = await fetchWithAuth(`/api/home/widgets?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to load your widgets");
  return res.json();
}

export async function recordModuleVisit(module: string): Promise<void> {
  await fetchWithAuth("/api/home/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module }),
  });
}
