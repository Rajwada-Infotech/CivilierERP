import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { SaTabs } from "@/components/sa/SaTabs";
import { LEAD_STAGES } from "@/components/sa/leadStages";
import { useCanApprove } from "@/hooks/useCanApprove";

const API = "/api/sa/lead-transfers";

async function fetchRequests(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error("Failed to fetch transfer requests");
  return r.json().catch(() => ({}));
}
async function fetchItems(requestId: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${requestId}/items`);
  if (!r.ok) throw new Error("Failed to fetch leads");
  return r.json().catch(() => ({}));
}

const FILTERS = ["Pending", "Approved", "Rejected", "All"];
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SaLeadTransfers: React.FC = () => {
  usePageRights("sa-lead-transfers");
  const { canDoAction } = useAuth();
  // Approval Setup decides who approves lead transfers (super admin always can) — the server says.
  const canApprove = useCanApprove("sa-lead-transfers") && canDoAction("sa-lead-transfers", "edit");
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loadedItems, setLoadedItems] = useState<Record<number, any[]>>({});
  const [loadingItems, setLoadingItems] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState("Pending");
  const [actionDialog, setActionDialog] = useState<{ id: number; action: "approve" | "reject"; fromName: string; toName: string; totalLeads: number } | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [acting, setActing] = useState(false);

  const { data: requests = [], isLoading, error, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-lead-transfers"], queryFn: fetchRequests, staleTime: 30_000 });

  const filtered = (requests as any[]).filter((r: any) => filterStatus === "All" || r.Status === filterStatus);

  const toggleExpand = async (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (!loadedItems[id]) {
      setLoadingItems((prev) => new Set(prev).add(id));
      try {
        const items = await fetchItems(id);
        setLoadedItems((prev) => ({ ...prev, [id]: items }));
      } catch {
        toast.error("Failed to load lead list");
      } finally {
        setLoadingItems((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }
    }
  };

  const handleAction = async () => {
    if (!actionDialog) return;
    setActing(true);
    try {
      const endpoint = actionDialog.action === "approve" ? "approve" : "reject";
      const r = await fetchWithAuth(`${API}/${actionDialog.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AdminNotes: adminNotes || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      toast.success(data.message);
      const resolvedId = actionDialog.id;
      setActionDialog(null);
      setAdminNotes("");
      await qc.invalidateQueries({ queryKey: ["sa-lead-transfers"] });
      await qc.invalidateQueries({ queryKey: ["sa-leads"] });
      // Refresh items cache for this request
      const items = await fetchItems(resolvedId);
      setLoadedItems((prev) => ({ ...prev, [resolvedId]: items }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setActing(false);
    }
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Pipeline", "Transfers"]} title="Lead Transfers">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load transfer requests. Refresh the page to try again." : "Loading transfer requests…"}
      </div>
    </SalesAutoShell>
  );

  const countOf = (s: string) => (requests as any[]).filter((r: any) => s === "All" || r.Status === s).length;
  const pendingCount = countOf("Pending");
  const pendingLeads = (requests as any[]).filter((r: any) => r.Status === "Pending").reduce((s: number, r: any) => s + Number(r.TotalLeads || 0), 0);

  const itemColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead ID", size: 100,
      cell: (i) => <span className="text-xs font-mono text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 150,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "Mobile", header: "Mobile", size: 110,
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue() as string}</span> },
    { accessorKey: "LeadStatus", header: "Stage", size: 100,
      cell: (i) => <span className="text-xs">{LEAD_STAGES.find((s) => s.key === i.getValue())?.label ?? String(i.getValue() ?? "—")}</span> },
    { accessorKey: "Classification", header: "Interest", size: 110,
      cell: (i) => (i.row.original.Classification ? <StatusBadge status={i.row.original.Classification} /> : <span className="text-muted-foreground text-xs">—</span>) },
    { accessorKey: "CurrentSalesperson", header: "With", size: 130,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CurrentSalesperson || "—"}</span> },
    { accessorKey: "Transferred", header: "Moved", size: 100, enableSorting: false,
      cell: (i) => (
        i.row.original.Transferred
          ? <span className="inline-flex items-center gap-1 text-emerald-600 font-medium text-xs"><CheckCircle2 size={12} /> Moved</span>
          : <span className="text-muted-foreground text-xs">Not yet</span>
      ) },
  ];

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Pipeline", "Transfers"]} title="Lead Transfers"
      subtitle={pendingCount
        ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} waiting — ${pendingLeads} lead${pendingLeads === 1 ? "" : "s"} to move between team leads`
        : "Team leads ask to move leads to another team; approving moves them."}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-5">
        <SaTabs
          tabs={FILTERS.map((s) => ({ key: s, label: `${s} (${countOf(s)})` }))}
          active={filterStatus}
          onChange={(key) => setFilterStatus(key)}
        />

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
            <ArrowRightLeft size={24} className="text-muted-foreground/40" />
            {filterStatus === "Pending" ? "Nothing waiting for approval." : `No ${filterStatus === "All" ? "" : filterStatus.toLowerCase() + " "}transfer requests.`}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((req: any) => {
              const isExpanded = expanded.has(req.Id);
              const items = loadedItems[req.Id] || [];
              const isLoadingItems = loadingItems.has(req.Id);
              return (
                <div key={req.Id} className="rounded-lg border border-border overflow-hidden">
                  {/* Request header */}
                  <div
                    className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${req.Status === "Pending" ? "bg-amber-500/5" : "bg-muted/20"}`}
                    onClick={() => toggleExpand(req.Id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded ? <ChevronDown size={15} className="text-muted-foreground shrink-0" /> : <ChevronRight size={15} className="text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{req.FromTeamLeadName}</span>
                          <ArrowRightLeft size={12} className="text-muted-foreground" />
                          <span className="text-sm font-semibold text-foreground">{req.ToTeamLeadName}</span>
                          <StatusBadge status={req.Status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                          <span><Clock size={10} className="inline mr-1" />{fmtDay(req.CreatedAt)}</span>
                          <span>{req.TotalLeads} lead{req.TotalLeads !== 1 ? "s" : ""}</span>
                          {req.RequestNotes && <span className="truncate max-w-[200px]">"{req.RequestNotes}"</span>}
                        </div>
                      </div>
                    </div>
                    {req.Status === "Pending" && canApprove && (
                      <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setActionDialog({ id: req.Id, action: "approve", fromName: req.FromTeamLeadName, toName: req.ToTeamLeadName, totalLeads: req.TotalLeads }); setAdminNotes(""); }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
                        >
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button
                          onClick={() => { setActionDialog({ id: req.Id, action: "reject", fromName: req.FromTeamLeadName, toName: req.ToTeamLeadName, totalLeads: req.TotalLeads }); setAdminNotes(""); }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 transition-colors"
                        >
                          <XCircle size={12} /> Reject
                        </button>
                      </div>
                    )}
                    {req.Status !== "Pending" && req.AdminNotes && (
                      <span className="text-xs text-muted-foreground ml-3 italic shrink-0 max-w-[200px] truncate">"{req.AdminNotes}"</span>
                    )}
                  </div>

                  {/* Lead items */}
                  {isExpanded && (
                    <div>
                      {isLoadingItems ? (
                        <div className="px-4 py-3 text-xs text-muted-foreground">Loading leads...</div>
                      ) : items.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-muted-foreground">No leads found</div>
                      ) : (
                        <DataTable
                          data={items}
                          columns={itemColumns}
                          searchable={false}
                          emptyMessage="No leads found"
                          className="border-t border-border"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Approve / Reject dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => { if (!o) { setActionDialog(null); setAdminNotes(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              {actionDialog?.action === "approve" ? "Approve Transfer Request" : "Reject Transfer Request"}
            </DialogTitle>
          </DialogHeader>
          {actionDialog && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{actionDialog.fromName}</span>
                  <ArrowRightLeft size={12} className="text-muted-foreground" />
                  <span className="text-foreground font-medium">{actionDialog.toName}</span>
                </div>
                <p className="text-xs text-muted-foreground">{actionDialog.totalLeads} lead{actionDialog.totalLeads !== 1 ? "s" : ""} will be {actionDialog.action === "approve" ? "reassigned to the destination team lead" : "kept with the current team"}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Admin Notes (optional)</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none"
                  placeholder="Reason or comments..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setActionDialog(null); setAdminNotes(""); }}
                  className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >Cancel</button>
                <button
                  onClick={handleAction}
                  disabled={acting}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors ${actionDialog.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
                >{acting ? "Saving…" : actionDialog.action === "approve" ? "Approve & move leads" : "Reject"}</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaLeadTransfers;
