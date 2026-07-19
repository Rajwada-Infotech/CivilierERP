import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import * as spApi from "@/api/supplierPortalApi";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search, ReceiptText, AlertTriangle } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n));

export default function SupplierCreditNotes() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [search, setSearch] = useState("");

  const { data: notes = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["supplier-credit-notes"],
    queryFn: spApi.getSupplierCreditNotes,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!search) return notes;
    const s = search.toLowerCase();
    return notes.filter(
      (n) =>
        n.DocNo?.toLowerCase().includes(s) ||
        n.ItemName?.toLowerCase().includes(s) ||
        n.ProjectName?.toLowerCase().includes(s) ||
        n.CompanyName?.toLowerCase().includes(s) ||
        n.PONumber?.toLowerCase().includes(s),
    );
  }, [notes, search]);

  const totalAmount = notes
    .filter((n) => n.Status !== "Cancelled")
    .reduce((s, n) => s + Number(n.Amount || 0), 0);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Hero */}
        <div
          className={`rounded-2xl p-6 border ${
            isDark
              ? "bg-gradient-to-br from-rose-950/40 via-background to-background border-rose-900/40"
              : "bg-gradient-to-br from-rose-50 via-background to-background border-rose-200"
          }`}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <ReceiptText className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Credit Notes</h1>
                <p className="text-sm text-muted-foreground">
                  Deductions raised against deliveries found to be below the ordered quality
                </p>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-card/60 border border-border/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Notes</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">{notes.length}</p>
            </div>
            <div className="rounded-xl bg-card/60 border border-border/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Deducted</p>
              <p className="text-xl font-semibold text-rose-500 mt-0.5">{fmt(totalAmount)}</p>
            </div>
            <div className="rounded-xl bg-card/60 border border-border/60 px-4 py-3 col-span-2 sm:col-span-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Active</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">
                {notes.filter((n) => n.Status !== "Cancelled").length}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search doc no, item, project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <ReceiptText className="w-8 h-8 opacity-30" />
            <p className="text-sm">No credit notes yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Doc No</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Date</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Company</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Delivery / PO</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Item</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">% Bad</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Amount</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((n) => (
                  <tr key={n.DebitNoteId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-foreground">{n.DocNo}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {n.DebitDate ? String(n.DebitDate).slice(0, 10) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-foreground">{n.CompanyName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-foreground">{n.ProjectName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-mono text-foreground">{n.VehicleInOutDocNo ?? "—"}</div>
                      {n.PONumber && (
                        <div className="text-[10px] text-muted-foreground font-mono">PO {n.PONumber}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium text-foreground">{n.ItemName ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {n.RejectedQty} of {n.ReceivedQty} {n.UomName ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600">
                        <AlertTriangle className="w-3 h-3" />
                        {Number(n.PercentBad).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-rose-600">
                      {fmt(n.Amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          n.Status === "Cancelled"
                            ? "bg-muted text-muted-foreground line-through"
                            : "bg-emerald-500/10 text-emerald-600"
                        }`}
                      >
                        {n.Status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
