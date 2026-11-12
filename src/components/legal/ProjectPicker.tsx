import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLegalLookup } from "@/api/legalMastersApi";

const KEY = "legal.projectId";

/** The project the Legal pages work under (Land Enquiries, Deed Registry Search). Remembered between pages. */
export function useLegalProject(): [number | null, (id: number | null) => void] {
  const [id, setId] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : null; } catch { return null; }
  });
  useEffect(() => {
    try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  }, [id]);
  return [id, setId];
}

export function ProjectPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["legal-lookup", "project"], queryFn: () => getLegalLookup("project"), staleTime: 5 * 60_000 });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3">
      <span className="text-sm font-semibold">Project</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="h-9 min-w-[16rem] border border-border bg-background px-2 text-sm">
        <option value="">{isLoading ? "Loading…" : "Select a project…"}</option>
        {projects.map((p) => <option key={String(p.value)} value={String(p.value)}>{p.label}</option>)}
      </select>
      {!value && <span className="text-xs text-amber-600">Select the project first</span>}
    </div>
  );
}
