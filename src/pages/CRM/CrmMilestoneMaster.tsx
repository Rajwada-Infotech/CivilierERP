import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/milestone-master";
const NUM = "font-heading tabular-nums";

// A failed load says so; it used to read "No milestones defined".
async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the milestones (${r.status}).`);
  return Array.isArray(data) ? data : [];
}

const CrmMilestoneMaster: React.FC = () => {
  const qc = useQueryClient();
  // The rights used to be fetched and ignored: New, Edit and Delete showed to everyone.
  const rights = usePageRights("crm-milestone-master");
  const ask = useSheetAsk();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // An existing milestone opens locked; Edit unlocks it. A new one opens unlocked.
  const [locked, setLocked] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");

  const { data: milestones = [], isLoading, isFetching, refetch, isError, error } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchAll, staleTime: 30_000 });

  const resetForm = () => { setEditingId(null); setName(""); setSortOrder(""); setLocked(false); setIsActive(true); };
  const close = () => { setDialogOpen(false); resetForm(); };
  const openNew = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (m: any) => {
    setEditingId(m.Id);
    setName(m.Name);
    setSortOrder(String(m.SortOrder ?? ""));
    setIsActive(m.IsActive !== false && m.IsActive !== 0);
    setLocked(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Name: name.trim(), SortOrder: sortOrder || 0, IsActive: isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the milestone");
      toast.success(isEdit ? "Milestone updated" : "Milestone created");
      close();
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: any) => {
    if (!(await ask.confirm(`Delete the milestone ${m.Name}? This cannot be undone.`, { okLabel: "Delete", danger: true }))) return;
    setDeletingId(m.Id);
    try {
      const res = await fetchWithAuth(`${API}/${m.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the milestone");
      toast.success("Milestone deleted");
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingId(null);
    }
  };

  const active = milestones.filter((m) => m.IsActive).length;
  const inUse = milestones.filter((m) => Number(m.PlanCount) > 0).length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return milestones.filter((m) => (!q || String(m.Name).toLowerCase().includes(q)) && (!status || (status === "active" ? m.IsActive : !m.IsActive)));
  }, [milestones, search, status]);

  const figures = [
    { label: "Milestones", value: milestones.length, note: "in all", onClick: () => setStatus("") },
    { label: "Active", value: active, note: "offered in the plan form", onClick: () => setStatus("active") },
    { label: "In a plan", value: inUse, note: "can't be deleted — deactivate instead" },
    { label: "Inactive", value: milestones.length - active, note: "kept for old plans", onClick: () => setStatus("inactive") },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const TABS = [
    { k: "" as const, l: "All", n: milestones.length },
    { k: "active" as const, l: "Active", n: active },
    { k: "inactive" as const, l: "Inactive", n: milestones.length - active },
  ];
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";
  const canWrite = editingId != null ? rights.canEdit : rights.canCreate;

  return (
    <>
      {ask.node}
      <Breadcrumbs items={["Dashboard", "CRM", "Milestone Master"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Milestones"
        subtitle="The steps a payment plan is built from — agreement, plinth, each slab, possession — in the order they fall due. Payment Plans picks from this list instead of retyping names."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New milestone</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  {x.onClick ? <button onClick={x.onClick} className="label link">{x.label}</button> : <p className="label">{x.label}</p>}
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-4 py-3 flex flex-wrap items-center gap-2.5" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {TABS.map((t) => (
                  <button key={t.k || "all"} onClick={() => setStatus(t.k)} className={tabClass(status === t.k)} style={{ borderRight: RULE_SOFT }}>
                    {t.l} <span className="tabular-nums">{t.n}</span>
                  </button>
                ))}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search milestones…"
                className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              {(search || status) && <button onClick={() => { setSearch(""); setStatus(""); }} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>}
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={`${th} w-20`}>Order</th><th className={th}>Milestone</th><th className={`${th} !text-right`}>In plans</th><th className={th}>State</th><th className={`${th} !text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={5} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={5} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={5} className={`${td} text-center text-muted-foreground`}>{milestones.length ? "No milestone matches." : "No milestones yet."}</td></tr>
                  ) : shown.map((m) => {
                    const used = Number(m.PlanCount) > 0;
                    return (
                      <tr key={m.Id} onClick={() => openEdit(m)} className={`cursor-pointer hover:bg-primary/5 transition-colors ${m.IsActive ? "" : "text-muted-foreground"}`} style={{ borderBottom: RULE_SOFT }}>
                        <td className={`${td} ${NUM} text-xs`}>{m.SortOrder}</td>
                        <td className={`${td} font-medium`}>{m.Name}</td>
                        <td className={`${td} text-right ${NUM} text-xs`}>{Number(m.PlanCount) || "—"}</td>
                        <td className={td}><SheetMark text={m.IsActive ? "Active" : "Inactive"} tone={m.IsActive ? "done" : "draft"} /></td>
                        <td className={td} onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {rights.canEdit && (
                              <button onClick={() => { openEdit(m); setLocked(false); }} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="Edit"><Pencil size={13} /></button>
                            )}
                            {/* Used by a plan: disabled with the reason, not hidden — the server refuses it anyway. */}
                            {rights.canDelete && (
                              <button onClick={() => handleDelete(m)} disabled={used || deletingId === m.Id}
                                title={used ? `Used by ${m.PlanCount} payment plan(s) — deactivate it instead` : "Delete"}
                                className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive disabled:opacity-35 disabled:hover:border-transparent"><Trash2 size={13} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetShell>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
          <div className="pb-3 flex items-start justify-between gap-3 pr-6" style={{ borderBottom: RULE }}>
            <div className="min-w-0">
              <p className={LBL}>Milestone</p>
              <DialogTitle className="mt-1 font-heading text-lg font-bold tracking-tight">{editingId != null ? name || "Milestone" : "New milestone"}</DialogTitle>
              {editingId != null && locked && <p className="mt-1 text-xs text-muted-foreground">Locked for viewing{rights.canEdit ? " — Edit to make changes." : "."}</p>}
            </div>
            {editingId != null && locked && rights.canEdit && (
              <button onClick={() => setLocked(false)} className={`${KEY_LINE} h-8 px-3 shrink-0`}><Pencil size={12} /> Edit</button>
            )}
          </div>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Name <span className="text-destructive">*</span></span>
              <input value={name} readOnly={locked} onChange={(e) => setName(e.target.value)} className={INP} />
            </label>
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Order</span>
              <input type="number" value={sortOrder} readOnly={locked} onChange={(e) => setSortOrder(e.target.value)} className={`${INP} font-heading tabular-nums`} />
            </label>
            <button type="button" role="switch" aria-checked={isActive} disabled={locked} onClick={() => setIsActive((v) => !v)}
              className="flex items-start gap-3 text-left disabled:opacity-60 disabled:cursor-not-allowed">
              <span className={`mt-0.5 relative h-4 w-7 shrink-0 border border-foreground transition-colors ${isActive ? "bg-foreground" : "bg-card"}`}>
                <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${isActive ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
              </span>
              <span className="text-xs">
                <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]">Status</span>
                <span className="text-muted-foreground"> — {isActive ? "Active: offered in the payment plan form." : "Inactive: hidden from the form, kept for old plans."}</span>
              </span>
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            {editingId != null && locked ? (
              <button onClick={close} className={`${KEY_LINE} h-9 px-4`}>Done</button>
            ) : (
              <>
                <button onClick={close} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                {canWrite && (
                  <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : editingId != null ? "Save changes" : "Create milestone"}</button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmMilestoneMaster;
