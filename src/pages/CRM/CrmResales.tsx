import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, ArrowRightLeft, TrendingUp, Landmark, X, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DateInput } from "@/components/ui/date-input";

const API = "/api/crm/resales";
const PLOT_API = "/api/plot-master";

// Resale: a plot changing hands between two buyers, with the
// developer facilitating rather than selling.
//
// THE DISTINCTION THIS SCREEN HAS TO MAKE OBVIOUS
// The developer is not selling the land here — the original buyer is. Their gain is
// theirs, not company revenue; only the facilitation fee is. The two figures
// are therefore shown in separate columns and never summed into a single
// "total", because a combined number is exactly what would end up being read as
// turnover.
const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Completed: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Cancelled: "text-red-600 bg-red-50 border-red-200",
};

const fmt = (n: any) =>
  n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

interface Resale {
  Id: number;
  PlotId: number | null;
  UnitId: number | null;
  PlotNo: string | null;
  PlotName: string | null;
  UnitName: string | null;
  FromBookingNo: string | null;
  ToBookingNo: string | null;
  FromCustomerName: string | null;
  ToCustomerName: string | null;
  ResaleDate: string | null;
  AgreedValue: number | null;
  OriginalValue: number | null;
  ResaleGain: number | null;
  DeveloperFeeAmount: number | null;
  DeveloperFeeGstAmount: number | null;
  Status: string;
  Notes: string | null;
}

async function fetchResales(): Promise<Resale[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error("Failed to load resales");
  return r.json().catch(() => []);
}

// Only plots someone currently holds can be resold — the API refuses the rest,
// so the picker is narrowed to the same set rather than letting a user choose
// something that can only fail on submit.
async function fetchHeldPlots(): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${PLOT_API}?`);
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    return (Array.isArray(rows) ? rows : []).filter((p: any) => p.LockBookingNo);
  } catch {
    return [];
  }
}

const CrmResales: React.FC = () => {
  const rights = usePageRights("crm-resales");
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const [completing, setCompleting] = useState<Resale | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    PlotId: "",
    AgreedValue: "",
    DeveloperFeeAmount: "",
    ResaleDate: new Date().toISOString().slice(0, 10),
    Notes: "",
  });
  const [toBookingId, setToBookingId] = useState("");

  const { data: resales = [], isLoading, dataUpdatedAt, isFetching } = useQuery({ queryKey: ["crm-resales"], queryFn: fetchResales });
  const { data: heldPlots = [] } = useQuery({ queryKey: ["crm-resale-held-plots"], queryFn: fetchHeldPlots });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-resales"] });
    qc.invalidateQueries({ queryKey: ["crm-resale-held-plots"] });
    // The plot changes hands, so every view of plot availability is stale.
    qc.invalidateQueries({ queryKey: ["unit-matrix"] });
    qc.invalidateQueries({ queryKey: ["plot-master"] });
  };

  const selectedPlot = useMemo(
    () => heldPlots.find((p: any) => String(p.Id) === form.PlotId),
    [heldPlots, form.PlotId],
  );

  const create = async () => {
    if (!form.PlotId) { toast.error("Which plot is changing hands?"); return; }
    if (!form.AgreedValue) { toast.error("What is the new buyer paying the original buyer?"); return; }
    setSaving(true);
    try {
      const r = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not record the resale");
      toast.success("Resale recorded — complete it once the new buyer's booking exists");
      setDialog(false);
      setForm({ PlotId: "", AgreedValue: "", DeveloperFeeAmount: "", ResaleDate: new Date().toISOString().slice(0, 10), Notes: "" });
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSaving(false); }
  };

  const complete = async () => {
    if (!completing || !toBookingId) { toast.error("The new buyer's booking id is required"); return; }
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/${completing.Id}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ToBookingId: toBookingId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not complete the resale");
      toast.success("Resale completed — the plot now sits with the new buyer");
      setCompleting(null);
      setToBookingId("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSaving(false); }
  };

  const cancel = async (row: Resale) => {
    try {
      const r = await fetchWithAuth(`${API}/${row.Id}/cancel`, { method: "PUT" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not cancel");
      toast.success("Resale cancelled");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const columns: ColumnDef<Resale>[] = [
    {
      header: "Plot / Unit",
      accessorKey: "PlotNo",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.PlotName || row.original.PlotNo || row.original.UnitName || "—"}
        </span>
      ),
    },
    {
      header: "From → To",
      id: "parties",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.FromCustomerName || row.original.FromBookingNo || "—"}
          <ArrowRightLeft size={10} className="inline mx-1" />
          {row.original.ToCustomerName || row.original.ToBookingNo || "pending"}
        </span>
      ),
    },
    { header: "Original Buyer Paid", accessorKey: "OriginalValue", cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.OriginalValue)}</span> },
    { header: "Resold At", accessorKey: "AgreedValue", cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.AgreedValue)}</span> },
    {
      header: "Resale Gain",
      accessorKey: "ResaleGain",
      cell: ({ row }) => {
        const g = Number(row.original.ResaleGain || 0);
        return (
          <span className={`tabular-nums font-medium ${g > 0 ? "text-emerald-600" : g < 0 ? "text-red-600" : ""}`}>
            {fmt(row.original.ResaleGain)}
          </span>
        );
      },
    },
    { header: "Our Fee", accessorKey: "DeveloperFeeAmount", cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.DeveloperFeeAmount)}</span> },
    {
      header: "Status",
      accessorKey: "Status",
      cell: ({ row }) => (
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[row.original.Status] || ""}`}>
          {row.original.Status}
        </span>
      ),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) =>
        rights.canEdit && row.original.Status !== "Completed" && row.original.Status !== "Cancelled" ? (
          <div className="flex gap-1.5 justify-end">
            <button onClick={() => setCompleting(row.original)}
              className="px-2 h-7 text-[0.6875rem] rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">
              Complete
            </button>
            <button onClick={() => cancel(row.original)}
              className="px-2 h-7 text-[0.6875rem] rounded-lg border border-border text-muted-foreground hover:bg-muted">
              Cancel
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <CrmShell title="Plot Resale" subtitle="A plot changing hands from its original buyer to a new buyer">
      <Breadcrumbs items={["CRM", "Plot Resale"]} />

      {/* Stated plainly on the screen, because the distinction is the whole
          point and is easy to get wrong when reading the numbers. */}
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 flex items-start gap-2 mb-3">
        <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          The original buyer is selling, not the company. <span className="font-medium text-foreground">Resale Gain</span> is
          theirs and is never company revenue — only <span className="font-medium text-foreground">Our Fee</span> is.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={invalidate} />
        {rights.canCreate && (
          <button onClick={() => setDialog(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
            <Plus size={14} /> Record Resale
          </button>
        )}
      </div>

      <DataTable columns={columns} data={resales} loading={isLoading} />

      {/* ── record ── */}
      <Dialog open={dialog} onOpenChange={(o) => { if (!o) setDialog(false); }}>
        <DialogContent accent="crm" className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Record a Plot Resale</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only plots currently held by someone can be resold. The outgoing owner and what they
              originally paid are taken from the live booking, not typed in.
            </p>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Plot</label>
              <select value={form.PlotId} onChange={(e) => setForm((f) => ({ ...f, PlotId: e.target.value }))}
                className="w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background">
                <option value="">Select a held plot…</option>
                {heldPlots.map((p: any) => (
                  <option key={p.Id} value={String(p.Id)}>
                    {p.PlotName || p.PlotNo} — {p.BlockName} (held by {p.LockBookingNo})
                  </option>
                ))}
              </select>
              {heldPlots.length === 0 && (
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  No plot is currently held by anyone, so there is nothing to resell yet.
                </p>
              )}
            </div>

            {selectedPlot && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[0.6875rem] text-muted-foreground flex items-center gap-2">
                <Landmark size={12} /> Currently held under <span className="font-medium text-foreground">{selectedPlot.LockBookingNo}</span>
                {selectedPlot.AreaSqFt ? ` · ${selectedPlot.AreaSqFt} sq ft` : ""}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                  New buyer pays original buyer (₹)
                </label>
                <input type="number" value={form.AgreedValue}
                  onChange={(e) => setForm((f) => ({ ...f, AgreedValue: e.target.value }))}
                  className="w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background font-semibold tabular-nums" />
              </div>
              <div>
                <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                  Our facilitation fee (₹)
                </label>
                <input type="number" value={form.DeveloperFeeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, DeveloperFeeAmount: e.target.value }))}
                  className="w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background tabular-nums" />
              </div>
            </div>

            <div>
              <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Resale Date</label>
              <DateInput value={form.ResaleDate}
                onChange={(e) => setForm((f) => ({ ...f, ResaleDate: e.target.value }))}
                className="w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background" />
            </div>

            <div>
              <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Notes</label>
              <textarea value={form.Notes} rows={2}
                onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background resize-none" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDialog(false)}
              className="px-4 h-9 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={create} disabled={saving}
              className="px-5 h-9 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Recording…" : "Record Resale"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── complete ── */}
      <Dialog open={!!completing} onOpenChange={(o) => { if (!o) setCompleting(null); }}>
        <DialogContent accent="crm" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Complete the Resale</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              This moves the plot. The outgoing line is kept as history, marked Transferred —
              nothing is cancelled, because the original sale stands and the original buyer was paid.
            </p>
          </DialogHeader>
          {completing && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-primary/80">Plot</p>
                <p className="text-sm font-semibold text-foreground">{completing.PlotName || completing.PlotNo}</p>
              </div>
              <div className="text-right">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1 justify-end">
                  <TrendingUp size={11} /> Resale gain
                </p>
                <p className="text-lg font-bold tabular-nums text-primary">{fmt(completing.ResaleGain)}</p>
              </div>
            </div>
          )}
          <div>
            <label className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
              New buyer&apos;s booking id
            </label>
            <input type="number" value={toBookingId} onChange={(e) => setToBookingId(e.target.value)}
              placeholder="The booking must already exist"
              className="w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setCompleting(null)}
              className="px-4 h-9 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
              <X size={13} className="inline mr-1" />Not yet
            </button>
            <button onClick={complete} disabled={saving}
              className="px-5 h-9 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Completing…" : "Complete Resale"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmResales;
