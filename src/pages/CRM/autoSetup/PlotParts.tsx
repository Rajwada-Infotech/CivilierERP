// Auto Project Setup for plotted blocks: where the land and villas stand, the plot layout per block, and the plots
// generated from it. Detailed plot work (areas, survey numbers, villas) stays in Plot Master.
import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark } from "@/components/sheet/Sheet";
import { API, INP, KEY_INK, KEY_LINE, LBL, NUM, Notice, PANEL, RULE, RULE_SOFT, Section, TEXT_LINK, lockOf, plural, type PlotSummary } from "./config";

type Confirm = (message: string, opts?: { okLabel?: string; danger?: boolean }) => Promise<boolean>;

// ── Land & villas at a glance ──
// A plotted project's real state is its land and what has been built on it: plots by where they stand, then — for a
// type that builds on its plots — villa types (each needs a room layout before a plot can be converted) and villas
// on DPR.
export const PlotSummaryPanel: React.FC<{ s: PlotSummary; buildsVillas: boolean; projectId?: string | number | null; canEdit: boolean }> = ({ s, buildsVillas, projectId, canEdit }) => {
  const qc = useQueryClient();
  const [filling, setFilling] = useState(false);
  // Villa rooms built before their room type had a DPR step list get one now.
  const fillDpr = async () => {
    if (!projectId) return;
    setFilling(true);
    try {
      const r = await fetchWithAuth(`${API}/projects/${projectId}/villas/fill-dpr`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not add the DPR steps");
      if (body.chainsCreated) toast.success(`${body.chainsCreated} villa room(s) given DPR steps`);
      if (body.stillWithoutSteps?.length) toast.warning(`Still no step list for: ${body.stillWithoutSteps.join(", ")} — set one chain for each in Dependency Master, then run this again.`);
      if (!body.chainsCreated && !body.stillWithoutSteps?.length) toast.info("Every villa room already has DPR steps");
      if (body.failed?.length) toast.error(body.failed.join("; "));
      await qc.invalidateQueries({ queryKey: ["plot-summary"] });
    } catch (e: any) { toast.error(e.message); } finally { setFilling(false); }
  };
  const row = (cells: { label: string; value: number; red?: boolean; hint?: string }[]) => (
    <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
      {cells.map((c) => (
        <div key={c.label} title={c.hint}>
          <p className="label">{c.label}</p>
          <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: c.red ? "var(--red)" : undefined }}>{c.value.toLocaleString("en-IN")}</p>
          {c.hint && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{c.hint}</p>}
        </div>
      ))}
    </div>
  );
  const typesMissingLayout = s.VillaTypes - s.VillaTypesWithLayout;
  return (
    <section className="bg-card" style={{ border: RULE }}>
      <header className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE }}>
        <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Land{buildsVillas ? " & villas" : ""}</h2>
        <Link to="/crm/setup/plot-master" className={TEXT_LINK}>Open Plot Master</Link>
      </header>
      {row([
        { label: "Plots", value: s.Plots },
        { label: "Available", value: s.Available },
        { label: "Held / applied", value: s.Held },
        { label: "Sold", value: s.Sold },
      ])}
      {buildsVillas && (
        <div style={{ borderTop: RULE_SOFT }}>
          {row([
            { label: "Villa types", value: s.VillaTypes },
            { label: "Built on (villas)", value: s.Villas, hint: `${s.BuiltOn} plot(s) converted` },
            { label: "Villas on DPR", value: s.VillasWithDpr },
            { label: "Planned, not built", value: s.PlannedNotBuilt, hint: "A villa type planned, not converted yet" },
          ])}
        </div>
      )}
      {buildsVillas && (typesMissingLayout > 0 || s.VillaRoomsWithoutDpr > 0) && (
        <div className="px-4 pb-4 space-y-2">
          {typesMissingLayout > 0 && (
            <Notice tone="fix">
              <span className={NUM}>{typesMissingLayout}</span> of <span className={NUM}>{s.VillaTypes}</span> villa type{s.VillaTypes === 1 ? "" : "s"} {typesMissingLayout === 1 ? "has" : "have"} no room layout — plots planned on {typesMissingLayout === 1 ? "it" : "them"} can&apos;t be converted yet. Set it in Plot Master → Villa types.
            </Notice>
          )}
          {s.VillaRoomsWithoutDpr > 0 && (
            <Notice tone="fix">
              <span className={NUM}>{s.VillaRoomsWithoutDpr}</span> villa room{s.VillaRoomsWithoutDpr === 1 ? " has" : "s have"} no DPR steps yet (no room of that type had a chain to copy). Set one chain for that room type in Dependency Master, then{" "}
              {canEdit ? (
                <button type="button" onClick={fillDpr} disabled={filling || !projectId} className={`${TEXT_LINK} font-semibold`}>
                  {filling ? "adding steps…" : "give them DPR steps now"}
                </button>
              ) : "ask someone who may edit this setup to add them"}.
            </Notice>
          )}
        </div>
      )}
    </section>
  );
};

// ── Plot layout ──
// One template per BLOCK, because in a plotted development the block IS the layout. The sizes SEED the generated
// plots; each plot's own area, dimensions, facing and survey number are edited per plot afterwards.
// Common plot-number styles (as used on site plans): P-1, Plot 1, PLOT NO 1, plain 1.
const PLOT_PREFIXES = ["P-", "Plot ", "PLOT NO ", ""];

export const PlotLayoutStep: React.FC<{ blocks: any[]; projectTypeName?: string; canEdit: boolean; canCreate: boolean; onChanged: () => void }> =
  ({ blocks, projectTypeName, canEdit, canCreate, onChanged }) => {
    const [drafts, setDrafts] = useState<Record<number, any>>({});
    const [busy, setBusy] = useState<number | null>(null);

    const draftFor = (b: any) => {
      const t = b.PlotTemplate;
      return drafts[b.Id] ?? {
        PlotCount: t?.PlotCount ?? "",
        NumberPrefix: t?.NumberPrefix ?? "P-",
        StartNumber: t?.StartNumber ?? 1,
        DefaultAreaSqFt: t?.DefaultAreaSqFt ?? "",
        DefaultRatePerSqFt: t?.DefaultRatePerSqFt ?? "",
        DefaultFacing: t?.DefaultFacing ?? "",
        DefaultRoadWidthFt: t?.DefaultRoadWidthFt ?? "",
      };
    };
    const patch = (b: any, p: any) => setDrafts((d) => ({ ...d, [b.Id]: { ...draftFor(b), ...p } }));

    const save = async (b: any) => {
      const d = draftFor(b);
      if (!d.PlotCount) { toast.error("How many plots?"); return; }
      setBusy(b.Id);
      try {
        const r = await fetchWithAuth(`${API}/blocks/${b.Id}/plot-template`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not save the plot layout");
        toast.success(`Plot layout saved for ${b.BlockName}`);
        onChanged();
      } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
    };

    const generate = async (b: any) => {
      setBusy(b.Id);
      try {
        const r = await fetchWithAuth(`${API}/generate-plots`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ BlockId: b.Id }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not generate plots");
        // Skipped names are reported, so a partially generated block isn't left wondering why the count is short.
        toast.success(`${body.created} plot(s) created in ${b.BlockName}` + (body.skipped?.length ? ` — ${body.skipped.length} already existed` : ""));
        onChanged();
      } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
    };

    return (
      <Section title="Plot layout" done={blocks.some((b) => b.PlotTemplate?.IsGenerated)}
        note={<>{projectTypeName ? `${projectTypeName} — no floors. ` : ""}Plots are laid out per block. These sizes seed every plot; each plot&apos;s own area, dimensions, facing and survey number are edited afterwards in Plot Master.</>}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {blocks.map((b) => {
            const d = draftFor(b);
            const t = b.PlotTemplate;
            const working = busy === b.Id;
            const head = (mark: React.ReactNode, right?: React.ReactNode) => (
              <div className="px-3 py-2.5 flex flex-wrap items-center gap-2" style={{ borderBottom: RULE_SOFT }}>
                <span className="text-sm font-semibold">Block {b.BlockName}</span>
                {mark}
                {right && <span className="ml-auto">{right}</span>}
              </div>
            );
            // Plots entered or imported directly in Plot Master: nothing to lay out here.
            if (t?.FromPlotMaster) return (
              <div key={b.Id} className={PANEL}>
                {head(<SheetMark text={`${plural(t.PlotsCreated, "plot")} in Plot Master`} tone="done" />)}
                <p className="px-3 py-2.5 text-xs text-muted-foreground">These plots were entered in Plot Master, each with its own number and area. Edit them there.</p>
              </div>
            );
            // Created: a locked summary — the plots are managed in Plot Master from here on.
            if (t?.IsGenerated) {
              const pre = t.NumberPrefix ?? "";
              const start = Number(t.StartNumber || 1);
              const last = start + Number(t.PlotsCreated || t.PlotCount || 1) - 1;
              const val = (v: any) => (v == null || v === "" ? "—" : Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN") : v);
              const cell = (label: string, value: React.ReactNode, wide = false) => (
                <div className={wide ? "col-span-2" : ""}><div className={LBL}>{label}</div><div className={`mt-1 text-sm ${NUM}`}>{value}</div></div>
              );
              return (
                <div key={b.Id} className={PANEL}>
                  {head(<SheetMark text={`${plural(t.PlotsCreated, "plot")} created`} tone="done" />,
                    <Link to="/crm/setup/plot-master" className={TEXT_LINK}>Manage in Plot Master</Link>)}
                  <div className="px-3 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {cell("Plot names", `${pre}${start}, ${pre}${start + 1} … ${pre}${last}`, true)}
                    {cell("Area", t.DefaultAreaSqFt ? `${val(t.DefaultAreaSqFt)} sq ft` : "—")}
                    {cell("Rate / sq ft", t.DefaultRatePerSqFt ? `₹${val(t.DefaultRatePerSqFt)}` : "—")}
                    {cell("Road · facing", `${t.DefaultRoadWidthFt ? `${val(t.DefaultRoadWidthFt)} ft` : "—"} · ${t.DefaultFacing || "—"}`)}
                  </div>
                </div>
              );
            }
            const f = (label: string, key: string, type = "number", placeholder = "") => (
              <label className="space-y-1 min-w-0">
                <span className={`block ${LBL}`}>{label}</span>
                <input type={type} value={d[key] ?? ""} placeholder={placeholder} disabled={!canEdit || working}
                  onChange={(e) => patch(b, { [key]: e.target.value })} className={`${INP} !h-8 !text-xs ${type === "number" ? `${NUM} text-right` : ""} disabled:opacity-50`} />
              </label>
            );
            const first = Number(d.StartNumber || 1);
            return (
              <div key={b.Id} className={PANEL}>
                {head(t ? <SheetMark text={`Layout saved · ${plural(Number(t.PlotCount), "plot")}`} tone="waiting" /> : <span className="text-xs text-muted-foreground">Not laid out yet</span>)}
                <div className="px-3 py-3 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {f("Plots", "PlotCount")}
                    {f("Start no.", "StartNumber")}
                    {f("Own prefix", "NumberPrefix", "text", "P-")}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${LBL} mr-1`}>Plot names</span>
                      {PLOT_PREFIXES.map((pre) => {
                        const on = (d.NumberPrefix ?? "") === pre;
                        return (
                          <button key={pre || "plain"} type="button" disabled={!canEdit || working} onClick={() => patch(b, { NumberPrefix: pre })}
                            className={`h-7 px-2 text-xs border ${NUM} transition-colors disabled:opacity-50 ${on ? "bg-foreground text-card border-foreground" : "border-foreground/30 hover:border-foreground"}`}>
                            {pre}{first}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Will be named{" "}
                      <span className={`${NUM} text-foreground`}>
                        {[0, 1].map((i) => `${d.NumberPrefix ?? ""}${first + i}`).join(", ")}
                        {Number(d.PlotCount) > 2 ? ` … ${d.NumberPrefix ?? ""}${first + Number(d.PlotCount) - 1}` : ""}
                      </span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {f("Area sq ft", "DefaultAreaSqFt")}
                    {f("Rate ₹ / sq ft", "DefaultRatePerSqFt")}
                    {f("Road ft", "DefaultRoadWidthFt")}
                  </div>
                  {f("Facing", "DefaultFacing", "text", "e.g. North")}
                  {(canEdit || (canCreate && t)) && (
                    <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE_SOFT }}>
                      {canEdit && (
                        <button onClick={() => save(b)} disabled={working} className={`${KEY_LINE} h-8 px-3`}>{working ? "Saving…" : "Save layout"}</button>
                      )}
                      {canCreate && t && (
                        <button onClick={() => generate(b)} disabled={working} className={`${KEY_INK} h-8 px-3`}>
                          {working ? "Generating…" : `Generate ${plural(Number(t.PlotCount), "plot")}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    );
  };

// ── The plots generated for a block ──
type PlotUnit = {
  Id: number; UnitName: string; PlotNo?: string; AreaSqFt?: number; RatePerSqFt?: number;
  Facing?: string; RoadWidthFt?: number; IsActive: boolean; UnitKind: string;
  LockBookingNo?: string; LockHoldId?: string; LockApplicationNo?: string;
};

export const PlotBlockBrowser: React.FC<{ blockId: number; canDelete: boolean; confirm: Confirm; onChanged: () => void }> = ({ blockId, canDelete, confirm, onChanged }) => {
  const [plots, setPlots] = useState<PlotUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchWithAuth(`${API}/blocks/${blockId}/plots`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "The plots didn't load.");
        if (live) setPlots(data.plots || []);
      })
      // A failed load used to read "No plots found".
      .catch((e) => { if (live) setError(e.message || "The plots didn't load."); });
    return () => { live = false; };
  }, [blockId]);

  const handleDelete = async (u: PlotUnit) => {
    if (!(await confirm(`Delete plot "${u.UnitName}"?`, { okLabel: "Delete", danger: true }))) return;
    setDeletingId(u.Id);
    try {
      const res = await fetchWithAuth(`${API}/plots/${u.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete plot");
      toast.success(data.message || "Plot deleted");
      setPlots((ps) => (ps || []).filter((p) => p.Id !== u.Id));
      onChanged();
    } catch (e: any) { toast.error(e.message); } finally { setDeletingId(null); }
  };

  return (
    <div className="space-y-2 pt-1">
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !plots ? (
        <p className="text-xs text-muted-foreground">Loading plots…</p>
      ) : !plots.length ? (
        <p className="text-xs text-muted-foreground">No plots in this block.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
          {plots.map((u) => {
            const lock = lockOf(u);
            const open = openId === u.Id;
            return (
              <div key={u.Id} onClick={() => setOpenId(open ? null : u.Id)}
                className={`p-2.5 text-xs cursor-pointer transition-colors border ${open ? "border-foreground bg-primary/5" : "border-foreground/25 bg-card hover:border-foreground"}`}>
                <div className={`${NUM} font-semibold truncate`}>{u.UnitName}</div>
                <div className="mt-0.5 text-muted-foreground truncate">
                  {u.AreaSqFt ? <><span className={NUM}>{Number(u.AreaSqFt).toLocaleString("en-IN")}</span> sq ft</> : "—"}
                  {u.RatePerSqFt ? <> · <span className={NUM}>₹{Number(u.RatePerSqFt).toLocaleString("en-IN")}</span>/sq ft</> : null}
                  {u.Facing ? ` · ${u.Facing}` : ""}
                </div>
                <div className="mt-1.5">{lock ? <SheetMark text={lock.text} tone={lock.tone} /> : <SheetMark text="Available" tone="done" />}</div>
                {open && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-2 pt-2 space-y-1.5" style={{ borderTop: RULE_SOFT }}>
                    {u.RoadWidthFt ? <div className="text-muted-foreground">Road <span className={NUM}>{u.RoadWidthFt}</span> ft</div> : null}
                    <div className="flex gap-3">
                      <Link to="/crm/setup/plot-master" className={TEXT_LINK}>Plot Master</Link>
                      {canDelete && (
                        <button onClick={() => handleDelete(u)} disabled={!!lock || deletingId === u.Id} className={`${TEXT_LINK} text-destructive`}>
                          {deletingId === u.Id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** The land inventory: every plot block, opening to its plots and their live availability. */
export const LandInventory: React.FC<{ blocks: any[]; projectId: string; canDelete: boolean; confirm: Confirm; onChanged: () => void }> =
  ({ blocks, projectId, canDelete, confirm, onChanged }) => {
    const [open, setOpen] = useState<Record<number, boolean>>({});
    return (
      <Section title="Land inventory" done={blocks.every((b) => !b.PlotTemplate || b.PlotTemplate.IsGenerated)}
        note="Live availability of each plot. Use Plot Master for filters, plot history, and conversion to Unit Master after construction."
        right={<Link to={`/crm/setup/plot-master?projectId=${projectId}`} className={TEXT_LINK}>Open Plot Master</Link>}>
        <div>
          {blocks.map((b) => {
            const tpl = b.PlotTemplate;
            const isOpen = !!open[b.Id];
            return (
              <div key={b.Id} className="py-2" style={{ borderBottom: RULE_SOFT }}>
                {tpl?.IsGenerated ? (
                  <button onClick={() => setOpen((m) => ({ ...m, [b.Id]: !isOpen }))} className="w-full flex items-center gap-2.5 text-left text-sm">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="font-medium">Block {b.BlockName}</span>
                    <span className="ml-auto text-xs text-muted-foreground"><span className={NUM}>{tpl.PlotsCreated ?? tpl.PlotCount}</span> plot(s)</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2.5 text-sm pl-[21px]">
                    <span className="font-medium">Block {b.BlockName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{tpl ? `${plural(Number(tpl.PlotCount), "plot")} laid out — generate them first` : "No layout set"}</span>
                  </div>
                )}
                {isOpen && <div className="pl-[21px]"><PlotBlockBrowser blockId={b.Id} canDelete={canDelete} confirm={confirm} onChanged={onChanged} /></div>}
              </div>
            );
          })}
        </div>
      </Section>
    );
  };

/** Where a plotted project stands: blocks, plots laid out and created, and which blocks still need work. */
export const PlotOverview: React.FC<{ projectName?: string; typeName?: string; blocks: any[]; canDelete: boolean; confirm: Confirm; onChanged: () => void }> =
  ({ projectName, typeName, blocks, canDelete, confirm, onChanged }) => {
    const [open, setOpen] = useState<Record<number, boolean>>({});
    const configured = blocks.reduce((s, b) => s + (b.PlotTemplate?.PlotCount ?? 0), 0);
    const created = blocks.reduce((s, b) => s + (b.PlotTemplate?.PlotsCreated ?? 0), 0);
    const pending = blocks.filter((b) => !b.PlotTemplate || !b.PlotTemplate.IsGenerated).length;
    const figures = [
      { label: "Blocks", value: blocks.length },
      { label: "Plots laid out", value: configured },
      { label: "Plots created", value: created },
      { label: "Blocks pending", value: pending, red: pending > 0 },
    ];
    const th = `!px-4 !py-2.5 text-left ${LBL}`;
    return (
      <section className="bg-card" style={{ border: RULE }}>
        <header className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderBottom: RULE }}>
          <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{projectName || "Project"} · overview</h2>
          <SheetMark text={typeName ?? "Plotted"} tone="moving" />
        </header>
        <div className="statrow four" style={{ padding: "16px 16px 18px", borderBottom: RULE }}>
          {figures.map((x) => (
            <div key={x.label}>
              <p className="label">{x.label}</p>
              <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{x.value.toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr style={{ borderBottom: RULE }}>
                <th className={th}>Block</th><th className={`${th} !text-right`}>Laid out</th><th className={`${th} !text-right`}>Created</th><th className={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const tpl = b.PlotTemplate;
                const isOpen = !!open[b.Id];
                return (
                  <React.Fragment key={b.Id}>
                    <tr onClick={() => setOpen((m) => ({ ...m, [b.Id]: !isOpen }))} className="cursor-pointer hover:bg-primary/5 transition-colors" style={{ borderBottom: RULE_SOFT }}>
                      <td className="!px-4 !py-3"><span className="inline-flex items-center gap-2 font-medium">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Block {b.BlockName}</span></td>
                      <td className={`!px-4 !py-3 text-right ${NUM}`}>{tpl ? tpl.PlotCount : "—"}</td>
                      <td className={`!px-4 !py-3 text-right ${NUM}`}>{tpl?.PlotsCreated ?? 0}</td>
                      <td className="!px-4 !py-3">
                        {!tpl ? <SheetMark text="Set up plot layout" tone="waiting" />
                          : !tpl.IsGenerated ? <SheetMark text={`Generate ${plural(Number(tpl.PlotCount), "plot")}`} tone="waiting" />
                          : <SheetMark text="Done" tone="done" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ borderBottom: RULE_SOFT }}>
                        <td colSpan={4} className="!px-4 !pt-1 !pb-3 bg-primary/[0.03]">
                          {tpl?.IsGenerated
                            ? <PlotBlockBrowser blockId={b.Id} canDelete={canDelete} confirm={confirm} onChanged={onChanged} />
                            : <p className="text-xs text-muted-foreground py-1">{tpl ? "Generate the plots first to browse them here." : "Set up the plot layout below first."}</p>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };
