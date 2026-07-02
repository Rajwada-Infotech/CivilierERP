import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import * as spApi from "@/api/supplierPortalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Save,
  Search,
  ListChecks,
  CheckCircle2,
  Circle,
  PackageSearch,
} from "lucide-react";

const rateCls =
  "w-full text-sm rounded-lg border border-border/60 px-2.5 py-1.5 bg-background/60 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition text-right font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none";
const cellCls =
  "w-full text-sm rounded-lg border border-border/60 px-2.5 py-1.5 bg-background/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";

interface RowState {
  ItemId: string;
  ItemName: string;
  UOMCode: string | null;
  Rate: string;
  SupplyLeadTime: string;
  Quality: string;
}

export default function SupplierCatalog() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
  });

  useEffect(() => {
    const next: Record<string, RowState> = {};
    for (const it of catalog) {
      next[it.ItemId] = {
        ItemId: it.ItemId,
        ItemName: it.ItemName,
        UOMCode: it.UOMCode,
        Rate: it.Rate != null ? String(it.Rate) : "",
        SupplyLeadTime: it.SupplyLeadTime ?? "",
        Quality: it.Quality ?? "",
      };
    }
    setRows(next);
    setDirty(new Set());
  }, [catalog]);

  const setRow = <K extends keyof RowState>(id: string, key: K, value: RowState[K]) => {
    setRows((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
    setDirty((p) => new Set(p).add(id));
  };

  const filteredRows = useMemo(() => {
    const list = Object.values(rows);
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((r) => r.ItemName?.toLowerCase().includes(s));
  }, [rows, search]);

  const pricedCount = Object.values(rows).filter((r) => Number(r.Rate) > 0).length;
  const totalCount = Object.values(rows).length;
  const unpricedCount = totalCount - pricedCount;
  const pricedPct = totalCount > 0 ? Math.round((pricedCount / totalCount) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      const items = Array.from(dirty)
        .map((id) => rows[id])
        .filter((r) => r && r.Rate && Number(r.Rate) > 0)
        .map((r) => ({
          ItemId: r.ItemId,
          ItemName: r.ItemName,
          UOMCode: r.UOMCode ?? undefined,
          Rate: Number(r.Rate) || 0,
          SupplyLeadTime: r.SupplyLeadTime || undefined,
          Quality: r.Quality || undefined,
        }));
      if (!items.length) throw new Error("Enter a rate for at least one item before saving");
      return spApi.updateSupplierCatalog(items);
    },
    onSuccess: () => {
      toast.success("Catalog saved");
      queryClient.invalidateQueries({ queryKey: ["supplier-catalog"] });
      setDirty(new Set());
    },
    onError: (err: any) => toast.error(err.message || "Failed to save catalog"),
  });

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      {/* Page-level emerald glow (matches dashboard) */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{
          position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)",
          width: "70vw", height: "40vh",
          background: "radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 70%)",
        }} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8 space-y-5">

        {/* ── Hero bar ─────────────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-2xl px-7 py-5 flex items-center gap-5"
          style={isDark ? {
            background: "rgba(15,17,26,0.52)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 4px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.08)",
            backdropFilter: "blur(22px) saturate(160%)",
          } : {
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%)",
            border: "1px solid #6ee7b7",
            boxShadow: "0 4px 24px rgba(16,185,129,0.12)",
          }}
        >
          {/* Dot grid */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle, ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)"} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }} />
          {/* Glow */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse at 20% 0%, rgba(16,185,129,0.18) 0%, transparent 60%)",
          }} />

          {/* Icon */}
          <div className="relative shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
            style={isDark
              ? { background: "linear-gradient(135deg, rgba(16,185,129,0.25) 0%, rgba(13,148,136,0.15) 100%)", border: "1px solid rgba(16,185,129,0.30)" }
              : { background: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(13,148,136,0.10) 100%)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <ListChecks size={22} className="text-emerald-500 dark:text-emerald-400" />
          </div>

          {/* Text */}
          <div className="relative flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground">Price Catalog</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set your standard rates, supply lead time, and quality for each item.
              {dirty.size > 0 && (
                <span className="ml-2 text-amber-500 dark:text-amber-400 font-medium">{dirty.size} unsaved change{dirty.size > 1 ? "s" : ""}</span>
              )}
            </p>
          </div>

          {/* Progress ring + Save */}
          <div className="relative shrink-0 flex items-center gap-4">
            {/* Mini progress */}
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <p className="text-xs text-muted-foreground">Catalog coverage</p>
              <div className="flex items-center gap-2">
                <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)" }}>
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pricedPct}%` }} />
                </div>
                <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400">{pricedPct}%</span>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={dirty.size === 0 || saveMutation.isPending}
              className="gap-1.5 shrink-0 bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 border-0 disabled:opacity-40"
            >
              {saveMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saveMutation.isPending ? "Saving…" : dirty.size > 0 ? `Save (${dirty.size})` : "Save Changes"}
            </Button>
          </div>
        </div>

        {/* ── Stat tiles ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card px-5 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
              <PackageSearch size={16} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalCount}</p>
              <p className="text-[11px] text-muted-foreground">Total items</p>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <CheckCircle2 size={16} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-500">{pricedCount}</p>
              <p className="text-[11px] text-muted-foreground">Priced</p>
            </div>
          </div>
          <div className={`rounded-xl px-5 py-4 flex items-center gap-3 ${unpricedCount > 0 ? "border border-amber-500/20 bg-amber-500/[0.03]" : "border border-border/60 bg-card/60"}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${unpricedCount > 0 ? "bg-amber-500/10" : "bg-muted/40"}`}>
              <Circle size={16} className={unpricedCount > 0 ? "text-amber-500" : "text-muted-foreground"} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${unpricedCount > 0 ? "text-amber-500" : ""}`}>{unpricedCount}</p>
              <p className="text-[11px] text-muted-foreground">Not priced</p>
            </div>
          </div>
        </div>

        {/* ── Table card ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-foreground">Items</span>
              {search && (
                <span className="text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                  {filteredRows.length} result{filteredRows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="relative w-60">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item…"
                className="pl-9 h-8 text-xs bg-background/40 border-border/60 focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm gap-2">
              <RefreshCw size={15} className="animate-spin" /> Loading catalog…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="pl-5 pr-2 py-3 w-5" />
                    <th className="px-2 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Item</th>
                    <th className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-20">UOM</th>
                    <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-36">Rate (₹)</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-40">Supply Lead Time</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-44">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-sm text-muted-foreground">
                        No items match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, idx) => {
                      const priced = Number(r.Rate) > 0;
                      const isDirty = dirty.has(r.ItemId);
                      return (
                        <tr
                          key={r.ItemId}
                          className={`border-b border-border/40 last:border-0 transition-colors ${
                            isDirty
                              ? "bg-amber-500/[0.04]"
                              : priced
                              ? "bg-emerald-500/[0.02]"
                              : idx % 2 === 1
                              ? "bg-muted/[0.015]"
                              : ""
                          }`}
                        >
                          {/* Indicator dot */}
                          <td className="pl-5 pr-1 py-2.5 w-5">
                            {priced ? (
                              <span className="block w-1.5 h-1.5 rounded-full bg-emerald-500 mx-auto" />
                            ) : (
                              <span className="block w-1.5 h-1.5 rounded-full bg-border mx-auto" />
                            )}
                          </td>
                          <td className="px-2 py-2.5 font-medium text-sm">{r.ItemName}</td>
                          <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{r.UOMCode || "—"}</td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={r.Rate}
                              onChange={(e) => setRow(r.ItemId, "Rate", e.target.value)}
                              className={`${rateCls} ${priced ? "border-emerald-500/30 bg-emerald-500/[0.04]" : ""}`}
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={r.SupplyLeadTime}
                              onChange={(e) => setRow(r.ItemId, "SupplyLeadTime", e.target.value)}
                              className={cellCls}
                              placeholder="e.g. 3 days"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={r.Quality}
                              onChange={(e) => setRow(r.ItemId, "Quality", e.target.value)}
                              className={cellCls}
                              placeholder="e.g. Grade A"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          {!isLoading && filteredRows.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/10">
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  <span className="text-emerald-500 font-semibold">{pricedCount}</span> of {totalCount} items priced
                </p>
                {dirty.size > 0 && (
                  <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                    {dirty.size} unsaved
                  </span>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={dirty.size === 0 || saveMutation.isPending}
                className="gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 border-0 disabled:opacity-40"
              >
                {saveMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                {saveMutation.isPending ? "Saving…" : dirty.size > 0 ? `Save (${dirty.size})` : "Save"}
              </Button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
