import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Send, Undo2, Clock, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/payments";

type DemandStatus = "Pending" | "Demanded" | "Paid";

interface DemandRow {
  Id: number;
  MilestoneNo: number;
  MilestoneName: string;
  AmountDue: number;
  AmountPaid: number;
  Percent: number | null;
  DueDate: string | null;
  Status: string;
  DemandStatus: DemandStatus;
  DemandNo: string | null;
  DemandRaisedOn: string | null;
  DemandNotes: string | null;
  BookingId: number;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
}

interface DemandSummary {
  pendingCount: number; pendingAmount: number;
  demandedCount: number; demandedAmount: number;
  paidCount: number; paidAmount: number;
}

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN");
}

async function fetchDemands(status: string, search: string): Promise<{ demands: DemandRow[]; summary: DemandSummary }> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (search) q.set("search", search);
  const res = await fetchWithAuth(`${API}/demands?${q}`);
  if (!res.ok) throw new Error("Failed to load demands");
  return res.json();
}

function StatusPill({ status }: { status: DemandStatus }) {
  if (status === "Pending")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"><Clock className="w-3 h-3" /> Pending</span>;
  if (status === "Demanded")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"><Send className="w-3 h-3" /> Demanded</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"><CheckCircle2 className="w-3 h-3" /> Paid</span>;
}

const CrmDemands: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseNotes, setRaiseNotes] = useState("");
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);
  const [raising, setRaising] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["crm-demands", status, search],
    queryFn: () => fetchDemands(status, search),
    placeholderData: (prev) => prev,
  });

  const rows = data?.demands ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => rows, [rows]);

  function applySearch() {
    setSearch(searchInput.trim());
  }

  async function handleRaise() {
    if (!raiseRow) return;
    setRaising(true);
    try {
      const res = await fetchWithAuth(`${API}/${raiseRow.Id}/demand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Notes: raiseNotes || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to raise demand");
      toast.success(`Demand raised — ${body.DemandNo}`);
      setRaiseRow(null);
      setRaiseNotes("");
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRaising(false);
    }
  }

  async function handleUndo() {
    if (!undoRow) return;
    setUndoing(true);
    try {
      const res = await fetchWithAuth(`${API}/${undoRow.Id}/demand/undo`, { method: "PATCH" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to undo demand");
      toast.success("Demand reverted to Pending");
      setUndoRow(null);
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUndoing(false);
    }
  }

  const columns: ColumnDef<DemandRow, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold">{i.row.original.BookingNo}</span> },
    { id: "applicant", header: "Applicant", size: 150, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="font-medium text-sm">{i.row.original.ApplicantName}</div>
          {i.row.original.Mobile && <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>}
        </div>
      ) },
    { id: "unit", header: "Project / Unit", size: 130, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="text-sm">{i.row.original.ProjectName ?? "—"}</div>
          <div className="text-xs text-muted-foreground font-mono">{i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "MilestoneName", header: "Milestone", size: 140,
      cell: (i) => (
        <div>
          <div className="text-sm font-medium">{i.row.original.MilestoneName}</div>
          {i.row.original.Percent != null && <div className="text-xs text-muted-foreground">{i.row.original.Percent}%</div>}
        </div>
      ) },
    { id: "balance", header: "Balance", size: 100,
      cell: (i) => <span className="font-semibold text-sm">{fmtMoney(Number(i.row.original.AmountDue || 0) - Number(i.row.original.AmountPaid || 0))}</span> },
    { accessorKey: "DueDate", header: "Due Date", size: 100, cell: (i) => <span className="text-sm">{fmtDate(i.row.original.DueDate)}</span> },
    { accessorKey: "DemandStatus", header: "Status", size: 100, cell: (i) => <StatusPill status={i.row.original.DemandStatus} /> },
    { accessorKey: "DemandNo", header: "Demand No.", size: 130,
      cell: (i) => i.row.original.DemandNo
        ? <span className="font-mono text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">{i.row.original.DemandNo}</span>
        : <span className="text-muted-foreground text-sm">—</span> },
    { accessorKey: "DemandRaisedOn", header: "Raised On", size: 100, cell: (i) => <span className="text-xs text-muted-foreground">{fmtDate(i.row.original.DemandRaisedOn)}</span> },
    { id: "action", header: "Action", size: 100, enableSorting: false,
      cell: (i) => {
        const row = i.row.original;
        if (row.DemandStatus === "Pending")
          return <button onClick={() => { setRaiseRow(row); setRaiseNotes(""); }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
            <Send className="w-3 h-3" /> Raise
          </button>;
        if (row.DemandStatus === "Demanded")
          return <button onClick={() => setUndoRow(row)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-muted">
            <Undo2 className="w-3 h-3" /> Undo
          </button>;
        return <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Paid</span>;
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Demands"
      subtitle="Raise and track payment demands against milestones"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button onClick={() => setStatus(status === "Pending" ? "" : "Pending")}
          className={`text-left rounded-xl border bg-card p-4 transition-all hover:shadow-md ${status === "Pending" ? "ring-2 ring-amber-400/60 border-amber-400" : "border-border"}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Pending</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{summary?.pendingCount ?? "—"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{fmtMoney(summary?.pendingAmount)}</p>
        </button>
        <button onClick={() => setStatus(status === "Demanded" ? "" : "Demanded")}
          className={`text-left rounded-xl border bg-card p-4 transition-all hover:shadow-md ${status === "Demanded" ? "ring-2 ring-primary/40 border-primary" : "border-border"}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Demanded</p>
          <p className="text-2xl font-bold text-primary">{summary?.demandedCount ?? "—"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{fmtMoney(summary?.demandedAmount)}</p>
        </button>
        <button onClick={() => setStatus(status === "Paid" ? "" : "Paid")}
          className={`text-left rounded-xl border bg-card p-4 transition-all hover:shadow-md ${status === "Paid" ? "ring-2 ring-emerald-400/60 border-emerald-400" : "border-border"}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Paid</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary?.paidCount ?? "—"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{fmtMoney(summary?.paidAmount)}</p>
        </button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="Search applicant, booking, demand no..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button onClick={applySearch} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted">Search</button>
        {(status || search) && (
          <button onClick={() => { setStatus(""); setSearch(""); setSearchInput(""); }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Clear filters</button>
        )}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No milestones found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={!!raiseRow} onOpenChange={(o) => { if (!o) { setRaiseRow(null); setRaiseNotes(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Raise Demand</DialogTitle></DialogHeader>
          {raiseRow && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {[
                  { label: "Booking", value: raiseRow.BookingNo },
                  { label: "Applicant", value: raiseRow.ApplicantName },
                  { label: "Milestone", value: raiseRow.MilestoneName },
                  { label: "Balance", value: fmtMoney(Number(raiseRow.AmountDue || 0) - Number(raiseRow.AmountPaid || 0)) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center px-3 py-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
                <textarea value={raiseNotes} onChange={(e) => setRaiseNotes(e.target.value)} rows={2}
                  placeholder="Any remarks for this demand…"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRaiseRow(null); setRaiseNotes(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRaise} disabled={raising}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              <Send className="w-3.5 h-3.5" /> {raising ? "Raising…" : "Raise Demand"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!undoRow} onOpenChange={(o) => !o && setUndoRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Demand?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert <strong>{undoRow?.DemandNo}</strong> back to <strong>Pending</strong> and clear the demand number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={undoing} onClick={handleUndo}>
              {undoing ? "Reverting…" : "Yes, Undo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesAutoShell>
  );
};

export default CrmDemands;
