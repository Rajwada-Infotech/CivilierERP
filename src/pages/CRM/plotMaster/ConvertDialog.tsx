// Build villas on the ticked plots: one villa per plot (each with its own planned villa type), or one villa across
// them all. It can't be undone, so with several plots the exact outcome is previewed and confirmed first.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { unitTypeOptions, type LayoutType } from "@/api/unitBhkConfigApi";
import { fetchVillaTypes, villaTypesKey, type VillaType } from "../VillaTypesDialog";
import {
  INP, KEY_INK, KEY_LINE, KEY_RED, LBL, NUM, RULE, RULE_SOFT, SETUP_API, TEXT_LINK,
  fetchConstructedAssetKinds, type ConstructedAssetKind, type Plot,
} from "./config";

export const ConvertDialog: React.FC<{
  open: boolean; onOpenChange: (open: boolean) => void;
  plots: Plot[]; layoutTypes: LayoutType[];
  canManageTypes: boolean; onManageTypes: () => void;
  /** After a run: the ids still to keep ticked (the plots that failed). */
  onDone: (keepIds: number[]) => void;
}> = ({ open, onOpenChange, plots, layoutTypes, canManageTypes, onManageTypes, onDone }) => {
  const queryClient = useQueryClient();
  const [unitName, setUnitName] = useState("");
  // One villa per plot: how each villa is named — {plot} is the plot's name.
  const [namePattern, setNamePattern] = useState("{plot}");
  const villaNameFor = (plotName: string) => (namePattern.trim() || "{plot}").split("{plot}").join(plotName).trim();
  const [unitType, setUnitType] = useState("");
  const [unitKind, setUnitKind] = useState("");
  const [villaRate, setVillaRate] = useState("");
  const [builtUpArea, setBuiltUpArea] = useState("");
  const [superBuiltUpArea, setSuperBuiltUpArea] = useState("");
  const [villaTypeId, setVillaTypeId] = useState("");
  // "each": one villa per plot (the default); "combine": one villa on all the ticked plots.
  const [mode, setMode] = useState<"each" | "combine">("each");
  const [confirmed, setConfirmed] = useState(false);
  const [converting, setConverting] = useState(false);

  const projectId = plots[0]?.ProjectId ?? null;
  const { data: villaTypes = [] } = useQuery<VillaType[]>({ queryKey: villaTypesKey(projectId), queryFn: () => fetchVillaTypes(projectId!), enabled: open && projectId != null });
  // Kinds offered = what the plots' project type sells.
  const { data: kinds = [] } = useQuery<ConstructedAssetKind[]>({ queryKey: ["constructed-asset-kinds", projectId], queryFn: () => fetchConstructedAssetKinds(projectId), staleTime: 60_000, enabled: open });
  const usableKinds = useMemo(() => kinds.filter((k) => !k.IsLand && k.IsActive !== false), [kinds]);
  const unitTypeChoices = useMemo(() => unitTypeOptions(layoutTypes, unitType), [layoutTypes, unitType]);

  // Picking a villa type fills the areas and room layout from the master; every field stays editable.
  const applyVillaType = (id: string, types: VillaType[] = villaTypes) => {
    setVillaTypeId(id);
    const type = types.find((t) => String(t.Id) === id);
    if (!type) return;
    setBuiltUpArea(String(type.BuiltUpAreaSqFt ?? ""));
    setSuperBuiltUpArea(type.SuperBuiltUpAreaSqFt != null ? String(type.SuperBuiltUpAreaSqFt) : "");
    const layout = layoutTypes.find((l) => l.id === type.LayoutTypeId);
    if (layout) setUnitType(layout.label);
  };
  // A villa type with its own rooms-by-floor plan decides the villa's rooms — no separate unit type is asked for then.
  const ownLayoutOf = (id: number | null | undefined) => {
    const t = villaTypes.find((x) => x.Id === id);
    const l = t?.LayoutTypeId != null ? layoutTypes.find((x) => x.id === t.LayoutTypeId) : undefined;
    return l?.ownerVillaTypeId ? l : null;
  };

  // Fresh each time it opens: the name from the plots, and one planned type across them pre-selected.
  useEffect(() => {
    if (!open) return;
    setUnitName(plots.map((p) => p.PlotName).join(" + "));
    setBuiltUpArea(""); setSuperBuiltUpArea(""); setVillaTypeId(""); setMode("each"); setConfirmed(false);
    const planned = new Set(plots.map((p) => p.PlannedVillaTypeId ?? null));
    const only = planned.size === 1 ? [...planned][0] : null;
    if (only != null && projectId != null) fetchVillaTypes(projectId).then((types) => applyVillaType(String(only), types)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A plot is built on as a villa: pre-pick the villa kind when the master has exactly one, else the only constructed
  // kind. A kind the project doesn't sell is dropped. Kinds are master data, so nothing else is assumed.
  useEffect(() => {
    if (!open || !kinds.length) return;
    if (unitKind && usableKinds.some((k) => k.Code === unitKind)) return;
    const villa = usableKinds.filter((k) => /villa/i.test(`${k.Code} ${k.Name}`));
    const pick = villa.length === 1 ? villa[0] : usableKinds.length === 1 ? usableKinds[0] : null;
    setUnitKind(pick ? pick.Code : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kinds]);
  // What was confirmed must be what gets created: any edit to the outcome asks again.
  useEffect(() => { setConfirmed(false); }, [plots, unitName, villaTypeId, builtUpArea, superBuiltUpArea, mode, namePattern]);

  const many = plots.length > 1;
  const separate = mode === "each" && many;
  const totalArea = plots.reduce((s, p) => s + Number(p.AreaSqFt || 0), 0);
  const typesById = new Map(villaTypes.map((t) => [t.Id, t]));
  const fallback = villaTypeId ? villaTypes.find((t) => String(t.Id) === villaTypeId) : undefined;
  const unplanned = plots.filter((p) => p.PlannedVillaTypeId == null);
  const rows = separate
    ? plots.map((plot) => {
        const own = plot.PlannedVillaTypeId != null ? typesById.get(plot.PlannedVillaTypeId) : undefined;
        const type = own ?? fallback;
        const bua = type ? Number(type.BuiltUpAreaSqFt) : Number(builtUpArea) || null;
        return { key: plot.Id, name: villaNameFor(plot.PlotName), on: [plot.PlotName], type: type?.Code ?? null, planned: !!own, bua };
      })
    : [{ key: 0, name: unitName.trim() || "Unnamed villa", on: plots.map((p) => p.PlotName), type: fallback?.Code ?? null, planned: false, bua: Number(builtUpArea) || null }];
  const missing = rows.filter((row) => !row.bua).length;
  const canSubmit = !converting && !!unitKind && (!many || confirmed) && missing === 0
    && (separate || (!!unitName.trim() && !!unitType && Number(builtUpArea) > 0));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    await queryClient.invalidateQueries({ queryKey: ["plot-summary"] });
    await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
  };

  // One villa per plot: each plot takes its own planned villa type; the dialog's type and areas cover plots that plan
  // none. Converted one by one, so a refusal on one plot doesn't stop the others.
  const convertEach = async () => {
    const jobs = plots.map((plot) => {
      const own = plot.PlannedVillaTypeId != null ? typesById.get(plot.PlannedVillaTypeId) : undefined;
      const layout = own ? layoutTypes.find((l) => l.id === own.LayoutTypeId)?.label : undefined;
      return {
        plot,
        body: {
          PlotIds: [plot.Id], UnitName: villaNameFor(plot.PlotName), UnitType: own ? layout : unitType, UnitKind: unitKind,
          RatePerSqFt: villaRate !== "" && Number(villaRate) > 0 ? Number(villaRate) : 0,
          VillaTypeId: own ? own.Id : (villaTypeId ? Number(villaTypeId) : null),
          BuiltUpAreaSqFt: own ? null : (builtUpArea ? Number(builtUpArea) : null),
          SuperBuiltUpAreaSqFt: own ? null : (superBuiltUpArea ? Number(superBuiltUpArea) : null),
        },
        ok: !!own || villaTypeId !== "" || Number(builtUpArea) > 0,
        // A planned type decides the rooms; one without a layout is reported, never silently swapped.
        typed: own ? !!layout : !!unitType,
      };
    });
    const noArea = jobs.filter((j) => !j.ok).map((j) => j.plot.PlotName);
    if (noArea.length) { toast.error(`No villa type planned on ${noArea.join(", ")} — choose a villa type or enter the built-up area for them`); return; }
    const noType = jobs.filter((j) => !j.typed).map((j) => j.plot.PlotName);
    if (noType.length) { toast.error(`No room layout for ${noType.join(", ")} — set the layout on their villa type (Villa types), or select a unit type for plots with no planned type`); return; }
    setConverting(true);
    const failed: { id: number; text: string }[] = [];
    let done = 0;
    let dprChains = 0;
    const noSteps = new Set<string>();
    for (const job of jobs) {
      try {
        const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || body.message || "Could not convert");
        done++;
        dprChains += Number(body.DprChainsCreated) || 0;
        (body.DprRoomsWithoutTemplate || []).forEach((room: string) => noSteps.add(room.replace(/\s*\d+$/, "")));
      } catch (e: any) { failed.push({ id: job.plot.Id, text: `${job.plot.PlotName}: ${e.message}` }); }
    }
    setConverting(false);
    if (done) toast.success(`${done} villa${done === 1 ? "" : "s"} created, one per plot — ${dprChains} DPR room chain${dprChains === 1 ? "" : "s"} set up`);
    if (noSteps.size) toast.warning(`No DPR steps exist yet for: ${[...noSteps].join(", ")}. Set up one chain for each in Dependency Master, then run "chainless rooms" to fill these villas.`, { duration: 12000 });
    if (failed.length) toast.error(`Not converted — ${failed.map((f) => f.text).join("; ")}`, { duration: 12000 });
    onDone(failed.map((f) => f.id));
    if (!failed.length) onOpenChange(false);
    await refresh();
  };

  const convert = async () => {
    if (!unitKind) { toast.error("Select the constructed asset kind"); return; }
    if (many && !confirmed) { toast.error("Tick the confirmation under the preview first"); return; }
    if (separate) { await convertEach(); return; }
    if (!unitName.trim() || !unitType) { toast.error("Select the constructed unit name, type, and kind"); return; }
    if (!(Number(builtUpArea) > 0)) { toast.error("Enter the villa's built-up area"); return; }
    setConverting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const rate = villaRate !== "" && Number(villaRate) > 0 ? Number(villaRate) : null;
      const response = await fetchWithAuth(`${SETUP_API}/plots/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          PlotIds: plots.map((p) => p.Id), Combine: many && confirmed, UnitName: unitName.trim(), UnitType: unitType, UnitKind: unitKind,
          RatePerSqFt: rate, VillaTypeId: villaTypeId ? Number(villaTypeId) : null,
          BuiltUpAreaSqFt: builtUpArea ? Number(builtUpArea) : null, SuperBuiltUpAreaSqFt: superBuiltUpArea ? Number(superBuiltUpArea) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Could not convert plots");
      toast.success(`${plots.length} plot${plots.length === 1 ? "" : "s"} converted to ${unitName.trim()} in Unit Master — ${Number(body.DprChainsCreated) || 0} DPR room chains set up`);
      if (body.DprRoomsWithoutTemplate?.length) toast.warning(`No DPR steps exist yet for: ${body.DprRoomsWithoutTemplate.join(", ")}. Set up one chain for each in Dependency Master.`, { duration: 12000 });
      onDone([]); onOpenChange(false);
      await refresh();
    } catch (e: any) {
      toast.error(e.name === "AbortError" ? "Request timed out — the server took too long. Please try again." : e.message);
    } finally { clearTimeout(timeout); setConverting(false); }
  };

  const field = (label: string, hint: string | null, children: React.ReactNode, wide = false) => (
    <label className={`block space-y-1 min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className={`block ${LBL}`}>{label}{hint && <span className="normal-case tracking-normal font-normal"> · {hint}</span>}</span>
      {children}
    </label>
  );
  const fromType = separate
    ? plots.length > 0 && plots.every((p) => p.PlannedVillaTypeId != null && !!ownLayoutOf(p.PlannedVillaTypeId))
    : villaTypeId !== "" && !!ownLayoutOf(Number(villaTypeId));
  const ownLayout = !separate && villaTypeId ? ownLayoutOf(Number(villaTypeId)) : null;
  const areasFromPlots = separate && unplanned.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-5xl gap-0 overflow-hidden p-0 rounded-none" style={{ border: RULE }}>
        <div className="px-5 pb-4 pt-5" style={{ borderBottom: RULE }}>
          <p className={LBL}>Plot Master · convert</p>
          <DialogTitle className="mt-1 font-heading text-lg font-bold tracking-tight">Build villas on plots</DialogTitle>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {plots.map((plot) => (
              <span key={plot.Id} className={`inline-flex items-center gap-1 h-6 px-2 text-xs border border-foreground/40 ${NUM}`}>
                {plot.PlotName}{plot.PlannedVillaTypeCode && <span className="text-muted-foreground">· {plot.PlannedVillaTypeCode}</span>}
              </span>
            ))}
            <span className="ml-1 text-xs text-muted-foreground">
              {plots[0]?.ProjectName} · Block {plots[0]?.BlockName} · {totalArea > 0 ? <><span className={NUM}>{totalArea.toLocaleString("en-IN")}</span> sq ft land</> : "land area pending"}
            </span>
          </div>
        </div>

        <div className="grid max-h-[70vh] overflow-y-auto thin-scroll md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="space-y-5 px-5 py-5">
            {many && (
              <section className="space-y-1.5">
                <p className={LBL}>How should they be built?</p>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Conversion">
                  {([
                    ["each", "One villa per plot", `${plots.length} villas, each on its own plot`, "Recommended"],
                    ["combine", "Combine into one villa", "One villa standing across all the plots", ""],
                  ] as const).map(([value, title, hint, badge]) => {
                    const active = mode === value;
                    return (
                      <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setMode(value)}
                        className={`p-3 text-left border transition-colors ${active ? "border-foreground bg-primary/5" : "border-foreground/25 hover:border-foreground"}`}
                        style={{ boxShadow: active ? "inset 0 -3px 0 hsl(var(--foreground))" : undefined }}>
                        <span className="block font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em]">{title}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
                        {badge && <span className={`mt-1.5 block ${LBL}`}>{badge}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Villa specification</p>
              {!separate ? (
                <div className="space-y-1">
                  {field("Villa name", null, <input autoFocus value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. V-21 or Rose Villa" className={INP} />)}
                  <p className="text-xs text-muted-foreground">The project and block prefix (like SLV/A/) is added for you. Rename it any time later from the plot.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {field("Villa names", null, <input value={namePattern} onChange={(e) => setNamePattern(e.target.value)} placeholder="{plot}" className={`${INP} ${NUM}`} />)}
                  <p className="text-xs text-muted-foreground">
                    <span className={NUM}>{"{plot}"}</span> is each plot&apos;s name — e.g. <span className={NUM}>V-{"{plot}"}</span> or <span className={NUM}>Villa {"{plot}"}</span>. First one: <span className="font-medium text-foreground">{villaNameFor(plots[0]?.PlotName || "P-1")}</span>
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <div className="flex items-end justify-between gap-2">
                  <span className={LBL}>{separate ? "Villa type for plots with none planned" : "Villa type"}</span>
                  {canManageTypes && <button type="button" onClick={onManageTypes} className={TEXT_LINK}>Manage types</button>}
                </div>
                <select value={villaTypeId} onChange={(e) => { if (e.target.value) applyVillaType(e.target.value); else setVillaTypeId(""); }} className={`${INP} disabled:opacity-60`} disabled={areasFromPlots}>
                  <option value="">{areasFromPlots ? "Every plot has its own planned type" : "None — enter the areas by hand"}</option>
                  {villaTypes.map((t) => <option key={t.Id} value={t.Id}>{t.Code} · {t.Name} · {Number(t.BuiltUpAreaSqFt).toLocaleString("en-IN")} sq ft</option>)}
                </select>
                {separate && unplanned.length > 0 && <p className="text-xs text-muted-foreground">No type planned on {unplanned.map((p) => p.PlotName).join(", ")}. Plots with a planned type use their own.</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {fromType
                  ? field("Rooms", null, <div className="h-9 px-2.5 flex items-center text-sm text-muted-foreground border border-foreground/20 bg-muted/30">
                      {ownLayout ? `From the villa type — ${ownLayout.roomCount} rooms, by floor` : "From each plot's villa type, by floor"}</div>)
                  : field("Unit type (room layout)", null, (
                    <select value={unitType} onChange={(e) => setUnitType(e.target.value)} className={INP}>
                      <option value="" disabled>Select a layout</option>
                      {unitTypeChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ))}
                {field("Asset kind", null, (
                  <select value={unitKind} onChange={(e) => setUnitKind(e.target.value)} className={INP}>
                    <option value="" disabled>Select a kind</option>
                    {usableKinds.map((k) => <option key={k.Id} value={k.Code}>{k.Name}</option>)}
                  </select>
                ))}
                {field("Construction rate", "optional", (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                    <input type="number" min="0" value={villaRate} onChange={(e) => setVillaRate(e.target.value)} placeholder="0" className={`${INP} !pl-6 !pr-16 ${NUM} text-right`} />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">per sq ft</span>
                  </div>
                ), true)}
                {([["Built-up area", builtUpArea, setBuiltUpArea, "required"], ["Super built-up area", superBuiltUpArea, setSuperBuiltUpArea, "optional"]] as const).map(([text, value, set, hint]) => (
                  <React.Fragment key={text}>
                    {field(text, hint, (
                      <div className="relative">
                        <input type="number" min="0" value={value} onChange={(e) => set(e.target.value)} disabled={areasFromPlots}
                          placeholder={areasFromPlots ? "From each plot's type" : "0"} className={`${INP} !pr-12 ${NUM} text-right disabled:opacity-60`} />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">sq ft</span>
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Priced on construction only. A sold plot&apos;s owner has already paid for the land and buys the villa as a separate booking. If super built-up is given, it is the saleable area.</p>
            </section>
          </div>

          {/* The result, before it is made. */}
          <aside className="flex flex-col gap-3 px-5 py-5 bg-primary/[0.03] border-t md:border-t-0 md:border-l border-foreground">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{separate ? `${rows.length} villas will be created` : many ? `${plots.length} plots → 1 villa` : "1 villa will be created"}</p>
              {missing > 0 && <span className="text-xs font-medium text-destructive">{missing} missing built-up area</span>}
            </div>
            {!separate && many && (
              <div className="px-3 py-2 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
                Merging is permanent: these plots can never be sold or built on separately again. Use it only when one villa really stands across them.
              </div>
            )}
            <ul className="max-h-72 overflow-y-auto thin-scroll bg-card" style={{ border: RULE }}>
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: RULE_SOFT }}>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${NUM}`}>{row.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">on {row.on.join(" + ")}</span>
                  </span>
                  <span className="text-right">
                    {row.type
                      ? <span className={`inline-block border border-foreground/40 px-1.5 text-[0.6875rem] font-semibold ${NUM}`}>{row.type}{row.planned ? "" : " *"}</span>
                      : <span className="text-[0.6875rem] text-muted-foreground">No type</span>}
                    <span className={`block text-xs ${NUM} ${row.bua ? "text-foreground" : "font-medium text-destructive"}`}>{row.bua ? `${row.bua.toLocaleString("en-IN")} sq ft` : "Built-up missing"}</span>
                  </span>
                </li>
              ))}
            </ul>
            {separate && rows.some((row) => row.type && !row.planned) && <p className="text-[0.6875rem] text-muted-foreground">* type chosen here, not planned on the plot</p>}
            <p className="text-xs text-muted-foreground">The plots stay in Plot Master as converted history and can no longer be booked or edited as plots.</p>
            {many && (
              <label className={`mt-auto flex cursor-pointer items-start gap-2.5 p-3 text-xs border ${confirmed ? "border-foreground bg-primary/5" : "border-foreground/30 bg-card"}`}>
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-foreground" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span><span className="font-medium">{separate ? `Create ${rows.length} separate villas as listed.` : `Merge ${plots.length} plots into one villa.`}</span> I understand this cannot be undone.</span>
              </label>
            )}
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5" style={{ borderTop: RULE }}>
          <button onClick={() => onOpenChange(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={convert} disabled={!canSubmit} className={`${!separate && many ? KEY_RED : KEY_INK} h-9 px-4`}>
            {converting ? "Converting…" : separate ? `Create ${plots.length} villas` : many ? `Merge ${plots.length} plots into 1 villa` : "Create villa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
