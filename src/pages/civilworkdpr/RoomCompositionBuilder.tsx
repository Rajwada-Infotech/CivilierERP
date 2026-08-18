import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getRoomCategoryOptions, type RoomCategory } from "@/api/roomCategoryMasterApi";
import {
  getBhkTemplate,
  saveBhkTemplate,
  getLayoutTypes,
  addLayoutType,
  type BhkType,
} from "@/api/unitBhkConfigApi";
import { Grid3x3, Home, Minus, Plus, Save, X } from "lucide-react";

const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

// A real layout can reasonably have a handful of any one room category —
// even a big custom Duplex/Triplex template — but not a typo like "40
// bedrooms" in a 1BHK. Mirrored server-side in unitBhkConfig.js's
// POST /template/:bhkType so this can't be bypassed by calling the API
// directly.
const MAX_ROOM_QTY = 10;

export default function RoomCompositionBuilder() {
  const rights = usePageRights("room-composition-builder");
  const qc = useQueryClient();
  const [bhkType, setBhkType] = useState<BhkType | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);
  const newTypeInputRef = useRef<HTMLInputElement>(null);

  const { data: layoutTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ["layout-types"],
    queryFn: getLayoutTypes,
    staleTime: 60 * 1000,
  });

  // Default to the first available type as soon as the list loads, so the
  // composition panel below always has something selected.
  useEffect(() => {
    if (!bhkType && layoutTypes.length > 0) setBhkType(layoutTypes[0].typeKey);
  }, [bhkType, layoutTypes]);

  useEffect(() => {
    if (addingType) newTypeInputRef.current?.focus();
  }, [addingType]);

  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["room-categories-options"],
    queryFn: getRoomCategoryOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: template, isFetching: loadingTemplate } = useQuery({
    queryKey: ["bhk-template", bhkType],
    queryFn: () => getBhkTemplate(bhkType as string),
    enabled: !!bhkType,
  });

  // Pre-fill quantities whenever a layout type with an existing template is
  // picked; a fresh type starts every active category at 0.
  useEffect(() => {
    if (template?.config) {
      const q: Record<number, number> = {};
      template.composition.forEach((c) => { q[c.roomCategoryId] = c.quantity; });
      setQuantities(q);
    } else if (!loadingTemplate) {
      setQuantities({});
    }
  }, [template, loadingTemplate]);

  const setQty = (categoryId: number, next: number) => {
    if (next > MAX_ROOM_QTY) {
      toast.error(`${MAX_ROOM_QTY} is the most of one room category a single unit can have.`);
      next = MAX_ROOM_QTY;
    }
    setQuantities((q) => ({ ...q, [categoryId]: Math.max(0, next) }));
  };

  const selectedLabel = layoutTypes.find((t) => t.typeKey === bhkType)?.label ?? bhkType ?? "";

  const handleSave = async () => {
    if (!bhkType) return;
    setSaving(true);
    try {
      await saveBhkTemplate(bhkType, {
        composition: (categories as RoomCategory[]).map((c) => ({
          roomCategoryId: c.id,
          quantity: quantities[c.id] ?? 0,
        })),
      });
      toast.success(`${selectedLabel} template saved`);
      qc.invalidateQueries({ queryKey: ["bhk-template", bhkType] });
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleAddType = async () => {
    const label = newTypeLabel.trim();
    if (!label) return;
    setAddingSaving(true);
    try {
      const created = await addLayoutType(label);
      toast.success(`"${created.label}" added`);
      await qc.invalidateQueries({ queryKey: ["layout-types"] });
      setBhkType(created.typeKey);
      setNewTypeLabel("");
      setAddingType(false);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't add type");
    } finally {
      setAddingSaving(false);
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
        subtitle="One room layout template per type — every unit of that type inherits it automatically"
        icon={Grid3x3}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <>
            {/* ── Layout type selector — the 4 BHK defaults plus any custom
                types (Duplex, Triplex, ...) added below. ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <Home size={14} className="text-cyan-600 dark:text-cyan-400" />
                <span className="text-sm font-heading font-semibold text-foreground">Layout Type</span>
              </div>
              <div className="p-5">
                {loadingTypes ? (
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-8 w-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {layoutTypes.map((t) => (
                      <button
                        key={t.typeKey}
                        type="button"
                        onClick={() => setBhkType(t.typeKey)}
                        className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border transition-all ${
                          bhkType === t.typeKey
                            ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}

                    {addingType ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/5 px-1.5 py-1">
                        <input
                          ref={newTypeInputRef}
                          value={newTypeLabel}
                          onChange={(e) => setNewTypeLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleAddType(); }
                            if (e.key === "Escape") { setAddingType(false); setNewTypeLabel(""); }
                          }}
                          placeholder="e.g. Duplex"
                          maxLength={50}
                          disabled={addingSaving}
                          className="w-28 h-6 px-2 rounded-md text-xs bg-background border border-border focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={handleAddType}
                          disabled={addingSaving || !newTypeLabel.trim()}
                          className="w-6 h-6 shrink-0 rounded-md bg-cyan-500 text-white flex items-center justify-center hover:bg-cyan-600 disabled:opacity-40 transition-colors"
                          title="Add"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingType(false); setNewTypeLabel(""); }}
                          disabled={addingSaving}
                          className="w-6 h-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors"
                          title="Cancel"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      rights.canCreate && (
                        <button
                          type="button"
                          onClick={() => setAddingType(true)}
                          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-dashed border-border text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all"
                        >
                          <Plus size={13} /> Add Type
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Composition ── */}
            {bhkType && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                  <Grid3x3 size={14} className="text-cyan-600 dark:text-cyan-400" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    {selectedLabel} Room Composition
                  </span>
                </div>
                <div className="p-5 space-y-5">
                  {loadingTemplate || loadingCategories ? (
                    <div className="h-24 rounded-lg border border-border bg-muted/30 animate-pulse" />
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        This layout applies to every unit tagged {selectedLabel} across every project,
                        tower, and floor — set it once here instead of per unit.
                      </p>

                      <div className="space-y-2">
                        <p className={labelCls}>Room Categories</p>
                        {(categories as RoomCategory[]).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No active room categories yet — add some in Room Category Master first.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {(categories as RoomCategory[]).map((c) => {
                              const qty = quantities[c.id] ?? 0;
                              return (
                                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5">
                                  <span className="text-xs font-heading font-semibold text-foreground">{c.alias}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setQty(c.id, qty - 1)}
                                      disabled={qty <= 0}
                                      className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                                    >
                                      <Minus size={11} />
                                    </button>
                                    <span className="w-5 text-center text-xs font-semibold tabular-nums">{qty}</span>
                                    <button
                                      type="button"
                                      onClick={() => setQty(c.id, qty + 1)}
                                      disabled={qty >= MAX_ROOM_QTY}
                                      title={qty >= MAX_ROOM_QTY ? `Max ${MAX_ROOM_QTY} per category` : undefined}
                                      className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                                    >
                                      <Plus size={11} />
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
                            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
                          >
                            <Save size={13} /> {saving ? "Saving…" : `Save ${selectedLabel} Template`}
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
