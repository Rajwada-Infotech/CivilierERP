import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { getRoomCategoryOptions, type RoomCategory } from "@/api/roomCategoryMasterApi";
import { getUnitBhkConfig, saveUnitBhkConfig, type BhkType } from "@/api/unitBhkConfigApi";
import { Building2, Layers, LayoutGrid, DoorOpen, Grid3x3, Minus, Plus, Save } from "lucide-react";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

const BHK_TYPES: BhkType[] = ["1BHK", "2BHK", "3BHK", "4BHK"];
const UNIT_API = "/api/unit-master";

async function fetchProjects(): Promise<{ Id: number; Name: string }[]> {
  try {
    const r = await fetchWithAuth(`${UNIT_API}/projects`);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}
async function fetchUnits(): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${UNIT_API}?isActive=1`);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

interface PickerState {
  ProjectId: string;
  BlockId: string;
  FloorNo: string;
  UnitId: string;
}
const EMPTY_PICKER: PickerState = { ProjectId: "", BlockId: "", FloorNo: "", UnitId: "" };

export default function RoomCompositionBuilder() {
  const rights = usePageRights("room-composition-builder");
  const qc = useQueryClient();
  const [picker, setPicker] = useState<PickerState>(EMPTY_PICKER);
  const [bhkType, setBhkType] = useState<BhkType | "">("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["room-comp-projects"],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000,
  });
  const { data: units = [], isLoading: loadingUnits } = useQuery({
    queryKey: ["room-comp-units"],
    queryFn: fetchUnits,
    staleTime: 5 * 60 * 1000,
  });
  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["room-categories-options"],
    queryFn: getRoomCategoryOptions,
    staleTime: 5 * 60 * 1000,
  });
  const loadingMasters = loadingProjects || loadingUnits || loadingCategories;

  // Same Project -> Tower -> Floor -> Unit cascade as the Work Done page,
  // reused here for the same reason: find the exact Unit without scrolling
  // through every unit in every project.
  const unitsForProject = useMemo(() => {
    if (!picker.ProjectId) return [];
    return (units as any[]).filter((u: any) => String(u.ProjectId) === picker.ProjectId);
  }, [units, picker.ProjectId]);
  const towersForProject = useMemo(() => {
    const map = new Map<string, string>();
    unitsForProject.forEach((u: any) => { if (u.BlockId != null) map.set(String(u.BlockId), u.BlockName); });
    return Array.from(map, ([Id, Name]) => ({ Id, Name }));
  }, [unitsForProject]);
  const unitsForTower = useMemo(() => {
    if (!picker.BlockId) return [];
    return unitsForProject.filter((u: any) => String(u.BlockId) === picker.BlockId);
  }, [unitsForProject, picker.BlockId]);
  const floorsForTower = useMemo(() => {
    const set = new Set<string>();
    unitsForTower.forEach((u: any) => { if (u.FloorNo != null) set.add(String(u.FloorNo)); });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [unitsForTower]);
  const unitsForFloor = useMemo(() => {
    if (!picker.FloorNo) return [];
    return unitsForTower.filter((u: any) => String(u.FloorNo) === picker.FloorNo);
  }, [unitsForTower, picker.FloorNo]);

  const selectedUnitId = picker.UnitId ? parseInt(picker.UnitId, 10) : null;
  const { data: existingConfig, isFetching: loadingConfig } = useQuery({
    queryKey: ["unit-bhk-config", selectedUnitId],
    queryFn: () => getUnitBhkConfig(selectedUnitId as number),
    enabled: !!selectedUnitId,
  });

  // Pre-fill BHK + quantities whenever a Unit with an existing config is
  // picked; a fresh Unit starts every active category at 0.
  useEffect(() => {
    if (!selectedUnitId) { setBhkType(""); setQuantities({}); return; }
    if (existingConfig?.config) {
      setBhkType(existingConfig.config.bhkType);
      const q: Record<number, number> = {};
      existingConfig.composition.forEach((c) => { q[c.roomCategoryId] = c.quantity; });
      setQuantities(q);
    } else if (!loadingConfig) {
      setBhkType("");
      setQuantities({});
    }
  }, [selectedUnitId, existingConfig, loadingConfig]);

  const handleProjectChange = (v: string) => setPicker({ ProjectId: v, BlockId: "", FloorNo: "", UnitId: "" });
  const handleTowerChange = (v: string) => setPicker((p) => ({ ...p, BlockId: v, FloorNo: "", UnitId: "" }));
  const handleFloorChange = (v: string) => setPicker((p) => ({ ...p, FloorNo: v, UnitId: "" }));
  const handleUnitChange = (v: string) => setPicker((p) => ({ ...p, UnitId: v }));

  const setQty = (categoryId: number, next: number) =>
    setQuantities((q) => ({ ...q, [categoryId]: Math.max(0, next) }));

  const handleSave = async () => {
    if (!selectedUnitId) { toast.error("Select a Unit first"); return; }
    if (!bhkType) { toast.error("Select a BHK type"); return; }
    setSaving(true);
    try {
      await saveUnitBhkConfig(selectedUnitId, {
        bhkType,
        composition: (categories as RoomCategory[]).map((c) => ({
          roomCategoryId: c.id,
          quantity: quantities[c.id] ?? 0,
        })),
      });
      toast.success("Room composition saved");
      qc.invalidateQueries({ queryKey: ["unit-bhk-config", selectedUnitId] });
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const totalRooms = Object.values(quantities).reduce((s, n) => s + (n || 0), 0);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Room Composition" },
        ]}
      />
      <CivilWorkDprShell
        title="Room Composition"
        subtitle="Set a Unit's BHK type and how many of each room category it has"
        icon={Grid3x3}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <>
            {/* ── Unit picker ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <DoorOpen size={14} className="text-cyan-600 dark:text-cyan-400" />
                <span className="text-sm font-heading font-semibold text-foreground">Unit</span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}><Building2 size={11} /> Project</label>
                  <select value={picker.ProjectId} onChange={(e) => handleProjectChange(e.target.value)} disabled={loadingMasters} className={inputCls}>
                    <option value="">Select project…</option>
                    {(projects as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><Layers size={11} /> Tower</label>
                  <select value={picker.BlockId} onChange={(e) => handleTowerChange(e.target.value)} disabled={!picker.ProjectId} className={inputCls}>
                    <option value="">{!picker.ProjectId ? "Select a project first" : "Select tower…"}</option>
                    {towersForProject.map((t) => <option key={t.Id} value={t.Id}>{t.Name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><LayoutGrid size={11} /> Floor</label>
                  <select value={picker.FloorNo} onChange={(e) => handleFloorChange(e.target.value)} disabled={!picker.BlockId} className={inputCls}>
                    <option value="">{!picker.BlockId ? "Select a tower first" : "Select floor…"}</option>
                    {floorsForTower.map((fl) => <option key={fl} value={fl}>Floor {fl}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><DoorOpen size={11} /> Unit</label>
                  <select value={picker.UnitId} onChange={(e) => handleUnitChange(e.target.value)} disabled={!picker.FloorNo} className={inputCls}>
                    <option value="">{!picker.FloorNo ? "Select a floor first" : "Select unit…"}</option>
                    {unitsForFloor.map((u: any) => <option key={u.Id} value={String(u.Id)}>{u.UnitName}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* ── BHK + composition ── */}
            {selectedUnitId && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                  <Grid3x3 size={14} className="text-cyan-600 dark:text-cyan-400" />
                  <span className="text-sm font-heading font-semibold text-foreground">BHK & Room Composition</span>
                </div>
                <div className="p-5 space-y-5">
                  {loadingConfig ? (
                    <div className="h-24 rounded-lg border border-border bg-muted/30 animate-pulse" />
                  ) : (
                    <>
                      <div className="max-w-xs">
                        <label className={labelCls}>BHK Type <span className="text-red-500">*</span></label>
                        <select value={bhkType} onChange={(e) => setBhkType(e.target.value as BhkType)} className={inputCls}>
                          <option value="">Select BHK type…</option>
                          {BHK_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Room Categories
                        </p>
                        {(categories as RoomCategory[]).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No active room categories yet — add some in Room Category Master first.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {(categories as RoomCategory[]).map((c) => {
                              const qty = quantities[c.id] ?? 0;
                              return (
                                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5">
                                  <span className="text-sm font-medium text-foreground">{c.alias}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setQty(c.id, qty - 1)}
                                      disabled={qty <= 0}
                                      className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                                    >
                                      <Minus size={12} />
                                    </button>
                                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                                    <button
                                      type="button"
                                      onClick={() => setQty(c.id, qty + 1)}
                                      className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    >
                                      <Plus size={12} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                          {totalRooms} room{totalRooms === 1 ? "" : "s"} total
                        </span>
                        {rights.canCreate && (
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            <Save size={14} /> {saving ? "Saving…" : "Save Composition"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CivilWorkDprShell>
    </>
  );
}
