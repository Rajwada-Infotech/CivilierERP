import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { invalidateRoomData } from "@/lib/roomQueries";
import { getRoomCategoryOptions, type RoomCategory } from "@/api/roomCategoryMasterApi";
import {
  getBhkTemplate,
  saveBhkTemplate,
  getLayoutTypes,
  addLayoutType,
  removeLayoutType,
  LAYOUT_TYPES_QUERY_KEY,
  type BhkType,
} from "@/api/unitBhkConfigApi";
import { Minus, Plus, Save, X } from "lucide-react";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const STEP = "w-7 h-7 flex items-center justify-center border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-30 disabled:hover:border-foreground/40";

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
  const [removingTypeKey, setRemovingTypeKey] = useState<string | null>(null);
  const newTypeInputRef = useRef<HTMLInputElement>(null);

  const { data: allLayoutTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: LAYOUT_TYPES_QUERY_KEY,
    queryFn: getLayoutTypes,
    staleTime: 60 * 1000,
  });
  // A villa type's own layout follows its floor-by-floor plan and is edited
  // in Plot Master > Villa types > Rooms — not offered here as flat counts.
  const layoutTypes = useMemo(() => allLayoutTypes.filter((t) => !t.ownerVillaTypeId), [allLayoutTypes]);
  const villaLayoutCount = allLayoutTypes.length - layoutTypes.length;

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
      // Deliberately does not touch any already-built room — this
      // composition is shared company-wide, but Room Master's own
      // project-scoped "Generate rooms" (Generate & Reconcile Rooms) is the
      // only thing that ever builds or reconciles actual rooms from it, one
      // project at a time. Auto-propagating a save here into every unit
      // that already had rooms built, across every project with no project
      // scoping, used to mean tweaking this for one project's needs could
      // silently add or delete rooms in an unrelated project.
      await saveBhkTemplate(bhkType, {
        composition: (categories as RoomCategory[]).map((c) => ({
          roomCategoryId: c.id,
          quantity: quantities[c.id] ?? 0,
        })),
      });
      toast.success(`${selectedLabel} template saved`);
      qc.invalidateQueries({ queryKey: ["bhk-template", bhkType] });
      // Room counts/summaries feed the CRM Auto Setup + Unit Master pickers.
      qc.invalidateQueries({ queryKey: LAYOUT_TYPES_QUERY_KEY });
      // The save just added/removed rooms across every unit of this type.
      invalidateRoomData(qc);
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
      await qc.invalidateQueries({ queryKey: LAYOUT_TYPES_QUERY_KEY });
      setBhkType(created.typeKey);
      setNewTypeLabel("");
      setAddingType(false);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't add type");
    } finally {
      setAddingSaving(false);
    }
  };

  const handleRemoveType = async (t: (typeof layoutTypes)[number]) => {
    if (!window.confirm(`Remove "${t.label}"? This can't be undone; it stays removable only while no unit is still tagged with it.`)) return;
    setRemovingTypeKey(t.typeKey);
    try {
      await removeLayoutType(t.typeKey);
      toast.success(`"${t.label}" removed`);
      if (bhkType === t.typeKey) setBhkType(null);
      await qc.invalidateQueries({ queryKey: LAYOUT_TYPES_QUERY_KEY });
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't remove type");
    } finally {
      setRemovingTypeKey(null);
    }
  };

  const totalRooms = Object.values(quantities).reduce((s, n) => s + (n || 0), 0);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Unit Composition" },
        ]}
      />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Unit composition"
        subtitle="One room layout per unit type. Every unit of that type takes its rooms from it."
      >
        {!rights.canView ? (
          <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-foreground/40">
            You don't have access to this page.
          </div>
        ) : (
          <>
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {[
                  { label: "Layout types", value: layoutTypes.length, note: villaLayoutCount ? `${villaLayoutCount} villa type${villaLayoutCount === 1 ? "" : "s"} planned elsewhere` : "offered for units" },
                  { label: "With a layout", value: layoutTypes.filter((x) => x.roomCount > 0).length, note: "can be picked for units" },
                  { label: "Room categories", value: (categories as RoomCategory[]).length, note: "active, to count from" },
                  { label: selectedLabel ? `Rooms in ${selectedLabel}` : "Rooms", value: totalRooms, note: "in the layout below" },
                ].map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Layout type selector — the 4 BHK defaults plus any custom
                types (Duplex, Triplex, ...) added below. ── */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex items-baseline gap-2.5 px-4 py-3" style={{ borderBottom: RULE }}>
                <span className={HEAD}>Layout type</span>
                {!loadingTypes && <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{layoutTypes.length}</span>}
              </div>
              <div className="p-4">
                {loadingTypes ? (
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-8 w-20 border border-foreground/20 bg-muted/30 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {layoutTypes.map((t) => {
                      const on = bhkType === t.typeKey;
                      return (
                        <div
                          key={t.typeKey}
                          role="button"
                          tabIndex={0}
                          aria-pressed={on}
                          onClick={() => setBhkType(t.typeKey)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBhkType(t.typeKey); } }}
                          className={`${KEY} h-8 px-3.5 shrink-0 cursor-pointer border ${
                            on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
                          }`}
                        >
                          {t.label}
                          {t.roomCount === 0 && (
                            <span
                              className="w-1.5 h-1.5 border border-current"
                              style={{ borderStyle: "dashed" }}
                              title="No rooms defined yet — this type can't be picked for units until it has a layout"
                            />
                          )}
                          {/* Only custom types (not the 4 seeded BHK defaults) can be
                              removed — same rule the backend enforces. */}
                          {!t.isSystem && rights.canDelete && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveType(t); }}
                              disabled={removingTypeKey === t.typeKey}
                              title={`Remove "${t.label}"`}
                              aria-label={`Remove ${t.label}`}
                              className="-mr-1.5 w-5 h-5 shrink-0 flex items-center justify-center opacity-60 hover:opacity-100 hover:text-destructive disabled:opacity-30 transition-colors"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {addingType ? (
                      <div className="flex items-center gap-1 border border-foreground px-1 h-8">
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
                          className="w-28 h-6 px-2 text-xs bg-card text-foreground border-0 focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={handleAddType}
                          disabled={addingSaving || !newTypeLabel.trim()}
                          className="w-6 h-6 shrink-0 bg-foreground text-card flex items-center justify-center disabled:opacity-40 transition-opacity"
                          title="Add"
                          aria-label="Add type"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingType(false); setNewTypeLabel(""); }}
                          disabled={addingSaving}
                          className="w-6 h-6 shrink-0 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                          title="Cancel"
                          aria-label="Cancel"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      rights.canCreate && (
                        <button
                          type="button"
                          onClick={() => setAddingType(true)}
                          className={`${KEY} h-8 px-3.5 shrink-0 border border-dashed border-foreground/50 text-muted-foreground hover:text-foreground hover:border-foreground`}
                        >
                          <Plus size={12} /> Add type
                        </button>
                      )
                    )}
                  </div>
                )}
                {villaLayoutCount > 0 && (
                  <p className="mt-3 text-[0.6875rem] text-muted-foreground">
                    Villa type layouts ({villaLayoutCount}) aren't listed here — their rooms are planned floor by floor in{" "}
                    <a href="/crm/setup/plot-master" className="text-foreground underline underline-offset-2 hover:no-underline">Plot Master › Villa types › Rooms</a>.
                  </p>
                )}
              </div>
            </div>

            {/* ── Composition ── */}
            {bhkType && (
              <div className="bg-card" style={{ border: RULE }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
                  <span className={HEAD}>{selectedLabel} composition</span>
                  <span className={LBL}>Up to {MAX_ROOM_QTY} of any one category</span>
                </div>
                {loadingTemplate || loadingCategories ? (
                  <div className="m-4 h-24 border border-foreground/20 bg-muted/30 animate-pulse" />
                ) : (
                  <>
                    <p className="px-4 pt-4 text-xs leading-relaxed text-muted-foreground">
                      This layout applies to every unit tagged {selectedLabel} — set it once here instead
                      of per unit. Saving never touches a room that's already been built; it only takes
                      effect for units whose rooms haven't been generated yet. To rebuild an already-built
                      unit's rooms from this layout, use Room Master's "Generate Rooms" for its project.
                    </p>

                    <div className="p-4 space-y-2">
                      <p className={LBL}>Room categories</p>
                      {(categories as RoomCategory[]).length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No active room categories yet — add some in Room Master first.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
                          {(categories as RoomCategory[]).map((c) => {
                            const qty = quantities[c.id] ?? 0;
                            return (
                              <div key={c.id} className="flex items-center justify-between gap-3 py-2 border-b border-foreground/15">
                                <span className={`text-sm ${qty ? "font-medium text-foreground" : "text-muted-foreground"}`}>{c.alias}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button type="button" onClick={() => setQty(c.id, qty - 1)} disabled={qty <= 0} className={STEP} aria-label={`One fewer ${c.alias}`}>
                                    <Minus size={11} />
                                  </button>
                                  <span className={`w-7 text-center font-heading text-sm font-semibold tabular-nums ${qty ? "text-foreground" : "text-muted-foreground/50"}`}>{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() => setQty(c.id, qty + 1)}
                                    disabled={qty >= MAX_ROOM_QTY}
                                    title={qty >= MAX_ROOM_QTY ? `Max ${MAX_ROOM_QTY} per category` : undefined}
                                    className={STEP}
                                    aria-label={`One more ${c.alias}`}
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

                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: RULE }}>
                      <span className="flex items-baseline gap-2">
                        <span className={LBL}>Total</span>
                        <span className="font-heading text-sm font-bold tabular-nums text-foreground">{totalRooms}</span>
                        <span className="text-xs text-muted-foreground">room{totalRooms === 1 ? "" : "s"}</span>
                      </span>
                      {rights.canCreate && (
                        <button onClick={handleSave} disabled={saving} className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}>
                          <Save size={13} /> {saving ? "Saving…" : `Save ${selectedLabel} layout`}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </SheetShell>
    </>
  );
}
