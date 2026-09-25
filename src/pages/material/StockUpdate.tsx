import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus, Plus, Trash2, Eye, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCompanies, getProjects, getGodowns, getItemOptions } from "@/api/issuesApi";
import { getUomList } from "@/api/uomApi";
import {
  createStockUpdate,
  getStockUpdate,
  getStockUpdates,
  type StockUpdateDetail,
} from "@/api/stockUpdateApi";

type Line = { key: number; itemId: string; uom: string; qty: string };

const todayStr = () => new Date().toISOString().slice(0, 10);
const inp =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50";
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n ?? 0);
const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

let lineKey = 0;
const newLine = (): Line => ({ key: ++lineKey, itemId: "", uom: "", qty: "" });

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{children}</label>;
}

export default function StockUpdate() {
  const rights = usePageRights("stock-update");
  const qc = useQueryClient();

  const [updateDate, setUpdateDate] = useState(todayStr());
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [godownId, setGodownId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [viewId, setViewId] = useState<number | null>(null);

  const { data: companies = [] } = useQuery({ queryKey: ["su-companies"], queryFn: getCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["su-projects"], queryFn: getProjects, staleTime: 5 * 60_000 });
  const { data: godowns = [] } = useQuery({ queryKey: ["su-godowns"], queryFn: getGodowns, staleTime: 5 * 60_000 });
  const { data: uoms = [] } = useQuery({ queryKey: ["su-uoms"], queryFn: getUomList, staleTime: 5 * 60_000 });
  const { data: items = [] } = useQuery({
    queryKey: ["su-items", godownId],
    queryFn: () => getItemOptions(godownId ? Number(godownId) : null),
    enabled: !!godownId,
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["stock-updates"],
    queryFn: getStockUpdates,
    enabled: rights.canView,
  });
  const { data: viewing, isLoading: viewLoading } = useQuery<StockUpdateDetail>({
    queryKey: ["stock-update", viewId],
    queryFn: () => getStockUpdate(viewId as number),
    enabled: viewId != null,
  });

  const companyProjects = useMemo(
    () => (projects as any[]).filter((p) => String(p.company_id ?? p.belongs_to) === companyId),
    [projects, companyId],
  );
  const projectGodowns = useMemo(
    () => (godowns as any[]).filter((g) => String(g.projectId) === projectId),
    [godowns, projectId],
  );
  const itemById = useMemo(() => {
    const m = new Map<string, any>();
    (items as any[]).forEach((i) => m.set(String(i.M_Id), i));
    return m;
  }, [items]);

  const itemOptions = useMemo(
    () => (items as any[]).map((i) => ({ value: String(i.M_Id), label: String(i.M_Name) })),
    [items],
  );

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: number, itemId: string) => {
    const it = itemById.get(itemId);
    setLine(key, { itemId, uom: it?.DefaultUOM || "" });
  };

  const reset = () => {
    setUpdateDate(todayStr());
    setCompanyId("");
    setProjectId("");
    setGodownId("");
    setRemarks("");
    setLines([newLine()]);
  };

  const save = useMutation({
    mutationFn: () =>
      createStockUpdate({
        UpdateDate: updateDate,
        CompanyId: Number(companyId),
        ProjectId: Number(projectId),
        GodownId: Number(godownId),
        Remarks: remarks.trim() || undefined,
        items: lines.map((l) => ({ ItemId: l.itemId, UOM: l.uom || null, Qty: Number(l.qty) })),
      }),
    onSuccess: (r) => {
      toast.success(`Stock updated (${r.DocNo})`);
      reset();
      qc.invalidateQueries({ queryKey: ["stock-updates"] });
      qc.invalidateQueries({ queryKey: ["su-items"] });
      qc.invalidateQueries({ queryKey: ["stock-ledger"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save stock update"),
  });

  const handleSave = () => {
    if (!updateDate) return toast.error("Pick the date of the update.");
    if (!companyId) return toast.error("Select a company.");
    if (!projectId) return toast.error("Select a project.");
    if (!godownId) return toast.error("Select a godown.");
    if (lines.some((l) => !l.itemId)) return toast.error("Every row needs an item.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return toast.error("Every quantity must be greater than zero.");
    const ids = lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) return toast.error("An item is listed twice. Combine it into one row.");
    save.mutate();
  };

  const usedIds = new Set(lines.map((l) => l.itemId).filter(Boolean));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Stock Update"]} />
      <MaterialShell title="Stock Update" subtitle="Add items to a project godown and update its stock" icon={PackagePlus}>
        {rights.canCreate && (
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-border/60">
              <h3 className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">New Stock Update</h3>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>Date of update</Label>
                  <input type="date" className={inp} value={updateDate} max={todayStr()} onChange={(e) => setUpdateDate(e.target.value)} />
                </div>
                <div>
                  <Label>Company</Label>
                  <select
                    className={inp}
                    value={companyId}
                    onChange={(e) => {
                      setCompanyId(e.target.value);
                      setProjectId("");
                      setGodownId("");
                      setLines([newLine()]);
                    }}
                  >
                    <option value="">— Select Company —</option>
                    {(companies as any[]).map((c) => (
                      <option key={c.id} value={c.id}>{c.label ?? c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Project / Site</Label>
                  <select
                    className={inp}
                    value={projectId}
                    disabled={!companyId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setGodownId("");
                      setLines([newLine()]);
                    }}
                  >
                    <option value="">{companyId ? "— Select Project —" : "Select a company first"}</option>
                    {companyProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Godown</Label>
                  <select
                    className={inp}
                    value={godownId}
                    disabled={!projectId}
                    onChange={(e) => {
                      setGodownId(e.target.value);
                      setLines([newLine()]);
                    }}
                  >
                    <option value="">{projectId ? "— Select Godown —" : "Select a project first"}</option>
                    {projectGodowns.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}{g.code ? ` (${g.code})` : ""}</option>
                    ))}
                  </select>
                  {projectId && projectGodowns.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">This project has no godown yet. Add one in Godown Master.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Items</Label>
                  <button
                    type="button"
                    disabled={!godownId}
                    onClick={() => setLines((ls) => [...ls, newLine()])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted/60 disabled:opacity-50 transition-colors"
                  >
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b border-border text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-left w-40">UOM</th>
                        <th className="px-3 py-2 text-right w-32">Current Stock</th>
                        <th className="px-3 py-2 text-right w-36">Qty to Add</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {lines.map((l) => {
                        const it = itemById.get(l.itemId);
                        return (
                          <tr key={l.key}>
                            <td className="px-3 py-2">
                              <SearchableSelect
                                value={l.itemId}
                                disabled={!godownId}
                                onChange={(v) => pickItem(l.key, v)}
                                placeholder={godownId ? "— Select Item —" : "Select a godown first"}
                                searchPlaceholder="Search items…"
                                options={itemOptions.map((o) => ({
                                  ...o,
                                  disabled: usedIds.has(o.value) && o.value !== l.itemId,
                                }))}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select className={inp} value={l.uom} disabled={!l.itemId} onChange={(e) => setLine(l.key, { uom: e.target.value })}>
                                <option value="">— UOM —</option>
                                {(uoms as any[]).map((u) => (
                                  <option key={u.UOMCode} value={u.UOMCode}>{u.UOMName ?? u.UOMCode}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                              {it ? fmtNum(Number(it.AvailableStock) || 0) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className={inp + " text-right"}
                                value={l.qty}
                                disabled={!l.itemId}
                                onChange={(e) => setLine(l.key, { qty: e.target.value })}
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                disabled={lines.length === 1}
                                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                                title="Remove row"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <Label>Remarks</Label>
                <input className={inp} value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note, e.g. opening stock count" />
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={reset} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 transition shadow-sm shadow-emerald-500/20"
                >
                  {save.isPending && <Loader2 size={14} className="animate-spin" />}
                  Save &amp; Update Stock
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between">
            <h3 className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">Previous Stock Updates</h3>
            <span className="text-[11px] text-muted-foreground">{history.length} record{history.length === 1 ? "" : "s"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Doc No</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Company</th>
                  <th className="px-4 py-2 text-left">Project</th>
                  <th className="px-4 py-2 text-left">Godown</th>
                  <th className="px-4 py-2 text-right">Items</th>
                  <th className="px-4 py-2 text-left">Created By</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {historyLoading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No stock updates yet.</td></tr>
                ) : (
                  history.map((h) => (
                    <tr key={h.StockUpdateId} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-xs text-emerald-600 dark:text-emerald-400">{h.DocNo || `#${h.StockUpdateId}`}</td>
                      <td className="px-4 py-2.5">{fmtDate(h.UpdateDate)}</td>
                      <td className="px-4 py-2.5">{h.CompanyName || "—"}</td>
                      <td className="px-4 py-2.5">{h.ProjectName || "—"}</td>
                      <td className="px-4 py-2.5">{h.GodownName || "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{h.ItemCount}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{h.CreatedByName || h.CreatedBy || "—"}</td>
                      <td className="px-2 py-2.5 text-center">
                        <button onClick={() => setViewId(h.StockUpdateId)} className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors" title="View">
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </MaterialShell>

      <Dialog open={viewId != null} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Stock Update {viewing?.DocNo ? `— ${viewing.DocNo}` : ""}</DialogTitle>
          </DialogHeader>
          {viewLoading || !viewing ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Date", fmtDate(viewing.UpdateDate)],
                  ["Company", viewing.CompanyName || "—"],
                  ["Project", viewing.ProjectName || "—"],
                  ["Godown", viewing.GodownName || "—"],
                  ["Created By", viewing.CreatedByName || viewing.CreatedBy || "—"],
                  ["Remarks", viewing.Remarks || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="px-3 py-2 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{k}</p>
                    <p className="font-semibold text-foreground">{v}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[9px] uppercase tracking-widest font-heading text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">UOM</th>
                      <th className="px-3 py-2 text-right">Qty Added</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {viewing.items.map((i) => (
                      <tr key={i.StockUpdateItemId}>
                        <td className="px-3 py-2 font-medium">{i.ItemName || i.ItemId}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.UOM || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtNum(i.Qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
