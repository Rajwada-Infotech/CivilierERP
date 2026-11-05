import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/brokerage-rate-tiers";
const NUM = "font-heading tabular-nums";
// What a deal gets when no active tier covers its value (tierBrokeragePercent, crmWorkflowGuards.js).
const FALLBACK_RATE = 2;

// A failed load says so; it used to read "No rate tiers defined".
async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the rate tiers (${r.status}).`);
  return Array.isArray(data) ? data : [];
}
const rs = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
/** ₹1,00,00,000 → "1 Cr", ₹50,00,000 → "50 L" — how deal values are spoken of. */
const short = (n: number) => (n >= 1e7 ? `${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `${+(n / 1e5).toFixed(2)} L` : n.toLocaleString("en-IN"));

// The default commission % by deal value — used only when Application / Booking staff don't type their own rate.
const CrmBrokerageRateTiers: React.FC = () => {
  const qc = useQueryClient();
  // The rights used to be fetched and ignored: New, Edit and Delete showed to everyone.
  const rights = usePageRights("crm-brokerage-rate-tiers");
  const ask = useSheetAsk();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [minVal, setMinVal] = useState("");
  const [maxVal, setMaxVal] = useState("");
  const [rate, setRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // An existing tier opens locked; Edit unlocks it.
  const [locked, setLocked] = useState(false);

  const { data: tiers = [], isLoading, isFetching, refetch, isError, error } = useQuery({ queryKey: ["crm-brokerage-rate-tiers-master"], queryFn: fetchAll, staleTime: 30_000 });

  const resetForm = () => { setEditingId(null); setMinVal(""); setMaxVal(""); setRate(""); setLocked(false); setIsActive(true); };
  const close = () => { setDialogOpen(false); resetForm(); };
  const openEdit = (t: any, unlock = false) => {
    setEditingId(t.Id);
    setMinVal(String(t.MinDealValue));
    setMaxVal(t.MaxDealValue != null ? String(t.MaxDealValue) : "");
    setRate(String(t.RatePercent));
    setIsActive(t.IsActive !== false && t.IsActive !== 0);
    setLocked(!unlock);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (minVal === "" || rate === "") { toast.error("Minimum deal value and rate are required"); return; }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MinDealValue: minVal, MaxDealValue: maxVal === "" ? null : maxVal, RatePercent: rate, IsActive: isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the tier");
      toast.success(isEdit ? "Tier updated" : "Tier created");
      close();
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers-master"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: any) => {
    if (!(await ask.confirm(`Delete the ${t.RatePercent}% tier (${rs(t.MinDealValue)} – ${t.MaxDealValue != null ? rs(t.MaxDealValue) : "and above"})? This cannot be undone.`, { okLabel: "Delete", danger: true }))) return;
    setDeletingId(t.Id);
    try {
      const res = await fetchWithAuth(`${API}/${t.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the tier");
      toast.success("Tier deleted");
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers-master"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingId(null);
    }
  };

  // Where the active tiers leave deal values uncovered (those get the fallback rate), and which tiers overlap
  // (saved before overlaps were refused; the higher minimum wins).
  const { gaps, overlapIds } = useMemo(() => {
    const active = tiers.filter((t) => t.IsActive).map((t) => ({ id: t.Id, min: Number(t.MinDealValue), max: t.MaxDealValue == null ? Infinity : Number(t.MaxDealValue) }))
      .sort((a, b) => a.min - b.min);
    const gapList: { from: number; to: number }[] = [];
    const overlaps = new Set<number>();
    let reach = 0;
    let reachId: number | null = null;
    for (const t of active) {
      if (t.min > reach) gapList.push({ from: reach, to: t.min });
      if (t.min < reach && reachId != null) { overlaps.add(t.id); overlaps.add(reachId); }
      if (t.max > reach) { reach = t.max; reachId = t.id; }
    }
    if (reach !== Infinity) gapList.push({ from: reach, to: Infinity });
    return { gaps: gapList, overlapIds: overlaps };
  }, [tiers]);

  const activeCount = tiers.filter((t) => t.IsActive).length;
  const figures = [
    { label: "Tiers", value: String(tiers.length), note: "in all" },
    { label: "Active", value: String(activeCount), note: "used to pick the default rate" },
    { label: "Uncovered ranges", value: String(gaps.length), note: `deals there get ${FALLBACK_RATE}%`, red: gaps.length > 0 && activeCount > 0 },
    { label: "Overlapping", value: String(overlapIds.size), note: "the higher minimum wins — fix them", red: overlapIds.size > 0 },
  ];
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";
  const canWrite = editingId != null ? rights.canEdit : rights.canCreate;

  return (
    <>
      {ask.node}
      <Breadcrumbs items={["Dashboard", "CRM", "Brokerage Rate Tiers"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Brokerage rate tiers"
        subtitle={`The default commission % by deal value — used only when Application / Booking staff don't type a rate of their own. A deal no active tier covers gets ${FALLBACK_RATE}%.`}
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => { resetForm(); setDialogOpen(true); }} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New tier</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Deal value</th><th className={`${th} !text-right`}>Rate</th><th className={th}>State</th><th className={`${th} !text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={4} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={4} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : tiers.length === 0 ? (
                    <tr><td colSpan={4} className={`${td} text-center text-muted-foreground`}>No rate tiers yet — every deal gets {FALLBACK_RATE}%.</td></tr>
                  ) : tiers.map((t) => {
                    const clash = overlapIds.has(t.Id);
                    return (
                      <tr key={t.Id} onClick={() => openEdit(t)} className={`cursor-pointer hover:bg-primary/5 transition-colors ${t.IsActive ? "" : "text-muted-foreground"}`}
                        style={{ borderBottom: RULE_SOFT, boxShadow: clash ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}>
                        <td className={td}>
                          <div className={`text-xs ${NUM}`}>{rs(t.MinDealValue)} – {t.MaxDealValue != null ? rs(t.MaxDealValue) : "and above"}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground">
                            {short(Number(t.MinDealValue))} {t.MaxDealValue != null ? `to under ${short(Number(t.MaxDealValue))}` : "and above"}
                          </div>
                        </td>
                        <td className={`${td} text-right ${NUM} font-semibold`}>{Number(t.RatePercent)}%</td>
                        <td className={td}>
                          {clash ? <SheetMark text="Overlaps another tier" tone="stopped" /> : <SheetMark text={t.IsActive ? "Active" : "Inactive"} tone={t.IsActive ? "done" : "draft"} />}
                        </td>
                        <td className={td} onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {rights.canEdit && <button onClick={() => openEdit(t, true)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="Edit"><Pencil size={13} /></button>}
                            {rights.canDelete && (
                              <button onClick={() => handleDelete(t)} disabled={deletingId === t.Id} title="Delete"
                                className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive disabled:opacity-35"><Trash2 size={13} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!isLoading && !isError && activeCount > 0 && gaps.length > 0 && (
              <p className="px-4 py-2.5 text-xs text-muted-foreground" style={{ borderTop: RULE_SOFT }}>
                Not covered by an active tier, so {FALLBACK_RATE}%:{" "}
                {gaps.map((g, i) => (
                  <span key={i} className={`${NUM} text-foreground`}>{i ? ", " : ""}{rs(g.from)} – {g.to === Infinity ? "and above" : `under ${rs(g.to)}`}</span>
                ))}
              </p>
            )}
          </div>
        </div>
      </SheetShell>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
          <div className="pb-3 flex items-start justify-between gap-3 pr-6" style={{ borderBottom: RULE }}>
            <div className="min-w-0">
              <p className={LBL}>Brokerage rate tier</p>
              <DialogTitle className="mt-1 font-heading text-lg font-bold tracking-tight">{editingId != null ? `${rate || "—"}% tier` : "New tier"}</DialogTitle>
              {editingId != null && locked && <p className="mt-1 text-xs text-muted-foreground">Locked for viewing{rights.canEdit ? " — Edit to make changes." : "."}</p>}
            </div>
            {editingId != null && locked && rights.canEdit && (
              <button onClick={() => setLocked(false)} className={`${KEY_LINE} h-8 px-3 shrink-0`}><Pencil size={12} /> Edit</button>
            )}
          </div>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>From deal value ₹ <span className="text-destructive">*</span></span>
              <input type="number" value={minVal} readOnly={locked} onChange={(e) => setMinVal(e.target.value)} className={`${INP} ${NUM} text-right`} />
              {minVal !== "" && Number(minVal) > 0 && <span className="block text-xs text-muted-foreground">{short(Number(minVal))}</span>}
            </label>
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Up to (not including) ₹</span>
              <input type="number" value={maxVal} readOnly={locked} onChange={(e) => setMaxVal(e.target.value)} placeholder="Blank — no upper limit" className={`${INP} ${NUM} text-right`} />
              {maxVal !== "" && Number(maxVal) > 0 && <span className="block text-xs text-muted-foreground">{short(Number(maxVal))}</span>}
            </label>
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Rate % <span className="text-destructive">*</span></span>
              <input type="number" step="0.01" min="0" max="10" value={rate} readOnly={locked} onChange={(e) => setRate(e.target.value)} className={`${INP} ${NUM} text-right`} />
            </label>
            <button type="button" role="switch" aria-checked={isActive} disabled={locked} onClick={() => setIsActive((v) => !v)}
              className="flex items-start gap-3 text-left disabled:opacity-60 disabled:cursor-not-allowed">
              <span className={`mt-0.5 relative h-4 w-7 shrink-0 border border-foreground transition-colors ${isActive ? "bg-foreground" : "bg-card"}`}>
                <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${isActive ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
              </span>
              <span className="text-xs">
                <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]">Status</span>
                <span className="text-muted-foreground"> — {isActive ? "Active: used to pick the default rate." : "Inactive: skipped, kept for history."}</span>
              </span>
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            {editingId != null && locked ? (
              <button onClick={close} className={`${KEY_LINE} h-9 px-4`}>Done</button>
            ) : (
              <>
                <button onClick={close} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                {canWrite && <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : editingId != null ? "Save changes" : "Create tier"}</button>}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmBrokerageRateTiers;
