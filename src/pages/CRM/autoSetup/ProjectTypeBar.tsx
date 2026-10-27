import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Map as MapIcon, Store, Home, Pencil } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { INP, KEY_INK, KEY_LINE, LBL, Notice, RULE } from "./config";

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
  // A failed load says so; it used to read as "no type chosen".
  const { data: types = [], isError: typesFailed } = useQuery<TypeRow[]>({
    queryKey: ["project-type-master"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/project-master/types");
      if (!r.ok) throw new Error("Could not load the project types");
      return r.json();
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
    <section className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Project type</span>
        {locked ? (
          <span className="text-sm font-semibold">{current?.Name}</span>
        ) : (
          <select value={projectTypeId ?? ""} disabled={!canEdit}
            onChange={(e) => put(`${API}/project-type`, { ProjectId: projectId, TypeId: e.target.value || null })}
            className={`${INP} !w-auto !h-8 min-w-[14rem]`}>
            <option value="">— Not set (towers, flats) —</option>
            {types.map((t) => <option key={t.Id} value={t.Id}>{t.Name}</option>)}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {(current ? sells(current) : [{ icon: Home, label: "Flats" }]).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 h-6 px-2 text-[0.6875rem] border border-foreground/30 text-muted-foreground">
              <s.icon size={11} /> {s.label}
            </span>
          ))}
        </div>
        {canEdit && blocks.length > 0 && current && (
          <button type="button" onClick={() => setEditing((v) => !v)} className={`${editing ? KEY_INK : KEY_LINE} h-8 px-3 ml-auto`}>
            {editing ? "Done" : <><Pencil size={11} /> Edit</>}
          </button>
        )}
      </div>
      {(typesFailed || !current) && (
        <div className="px-4 pb-3">
          {typesFailed
            ? <Notice tone="error">The project types didn&apos;t load, so this project&apos;s type can&apos;t be shown or changed. Reload the page.</Notice>
            : <Notice tone="fix">Choose a type so the setup and bookings follow it.</Notice>}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.15)" }}>
          <span className={`${LBL} mr-1`}>Blocks</span>
          {blocks.map((b) => {
            const L = layoutOf(b.HasFloors !== false);
            return (
              <span key={b.Id} className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs border border-foreground/30">
                <L.icon size={12} />
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
    </section>
  );
}
