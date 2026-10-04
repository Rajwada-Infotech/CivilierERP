import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Map as MapIcon, Store, Home, Shapes, Lock, Pencil } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// The project type, shown and chosen at the top of Auto Project Setup — it
// decides how every block below is laid out (tower floors or a plot layout)
// and what may be sold (flats, shops / offices, plots & villas). In a type
// that allows both layouts (e.g. a mixed township) each block picks its own.
// Types come from Project Type Master; nothing here names one.

const API = "/api/crm/project-auto-setup";
type TypeRow = { Id: number; Name: string; HasFloors: boolean; SellsLand: boolean; SellsConstruction: boolean; AllowsMultiUnitSale: boolean; SellsResidential?: boolean; SellsCommercial?: boolean };

const sells = (t?: Partial<TypeRow> | null) => {
  if (!t) return [];
  const out: { icon: React.ElementType; label: string }[] = [];
  if (t.SellsConstruction && t.SellsResidential !== false) out.push({ icon: Home, label: "Flats / villas" });
  if (t.SellsConstruction && t.SellsCommercial) out.push({ icon: Store, label: "Shops / offices" });
  if (t.SellsLand) out.push({ icon: MapIcon, label: "Plots" });
  return out;
};
const layoutOf = (hasFloors: boolean) => (hasFloors ? { icon: Building2, label: "Tower" } : { icon: MapIcon, label: "Plots & villas" });

interface Props {
  projectId: number;
  status: any;
  canEdit: boolean;
  onChanged: () => void;
}

export function ProjectTypeBar({ projectId, status, canEdit, onChanged }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: types = [] } = useQuery<TypeRow[]>({
    queryKey: ["project-type-master"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/project-master/types");
      return r.ok ? r.json() : [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const projectTypeId: number | null = status?.projectType?.Id ?? null;
  const current = types.find((t) => t.Id === projectTypeId) ?? null;
  const blocks: any[] = status?.blocks ?? [];
  // Blocks choose their own layout only where the type allows both, or a block already has its own.
  const perBlock = (!!current && current.HasFloors && current.SellsLand) || blocks.some((b) => b.OwnTypeId);
  // Open while the project has no blocks yet (or no type); locked afterwards — Edit to change.
  const locked = !editing && blocks.length > 0 && !!current;
  const ownTypeName = (b: any) => types.find((t) => t.Id === b.OwnTypeId)?.Name;

  const put = async (url: string, body: object) => {
    const r = await fetchWithAuth(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(data.error || "Couldn't change the type");
    toast.success("Type updated");
    // Every screen that shows a project's / block's type picks it up straight away.
    ["project-master", "project-type-master", "block-master", "enterprises-list"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onChanged();
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Shapes size={15} className="text-violet-600" />
        <span className="text-sm font-semibold">Project type</span>
        {locked ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Lock size={12} className="text-muted-foreground" /> {current?.Name}</span>
        ) : (
          <select value={projectTypeId ?? ""} disabled={!canEdit}
            onChange={(e) => put(`${API}/project-type`, { ProjectId: projectId, TypeId: e.target.value || null })}
            className="px-2 py-1 text-sm rounded-lg border border-border bg-background">
            <option value="">— Not set (towers, flats) —</option>
            {types.map((t) => <option key={t.Id} value={t.Id}>{t.Name}</option>)}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {(current ? sells(current) : [{ icon: Home, label: "Flats" }]).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              <s.icon size={11} /> {s.label}
            </span>
          ))}
        </div>
        {!current && <span className="text-[0.6875rem] text-amber-700 dark:text-amber-400">Choose a type so the setup and bookings follow it.</span>}
        {canEdit && blocks.length > 0 && current && (
          editing ? (
            <button type="button" onClick={() => setEditing(false)} className="ml-auto px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted/50">Done</button>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
              <Pencil size={11} /> Edit
            </button>
          )
        )}
      </div>

      {blocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground mr-1">Blocks</span>
          {blocks.map((b) => {
            const L = layoutOf(b.HasFloors !== false);
            return (
              <span key={b.Id} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs">
                <L.icon size={12} className={b.HasFloors !== false ? "text-violet-600" : "text-emerald-600"} />
                <span className="font-medium">{b.BlockName}</span>
                {perBlock && !locked ? (
                  <select value={b.OwnTypeId ?? ""} disabled={!canEdit}
                    onChange={(e) => put(`${API}/blocks/${b.Id}/type`, { TypeId: e.target.value || null })}
                    className="bg-transparent text-muted-foreground outline-none">
                    <option value="">{current ? `Same as project · ${L.label}` : L.label}</option>
                    {types.map((t) => <option key={t.Id} value={t.Id}>{t.Name} · {layoutOf(t.HasFloors).label}</option>)}
                  </select>
                ) : (
                  <span className="text-muted-foreground">· {b.OwnTypeId ? `${ownTypeName(b) ?? "Own type"} · ` : ""}{L.label}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
