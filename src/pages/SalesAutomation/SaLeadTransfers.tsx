import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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

const statusBadge = (status: string) => {
  if (status === "Approved") return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600">Approved</span>;
  if (status === "Rejected") return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-500">Rejected</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600">Pending</span>;
};

const SaLeadTransfers: React.FC = () => {
  const { canDoAction } = useAuth();
  const canApprove = canDoAction("sa-lead-transfers", "edit");
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loadedItems, setLoadedItems] = useState<Record<number, any[]>>({});
  const [loadingItems, setLoadingItems] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState("Pending");
  const [actionDialog, setActionDialog] = useState<{ id: number; action: "approve" | "reject"; fromName: string; toName: string; totalLeads: number } | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [acting, setActing] = useState(false);

  const { data: requests = [], isLoading } = useQuery({ queryKey: ["sa-lead-transfers"], queryFn: fetchRequests, staleTime: 30_000 });

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
      toast.error(e.message);
    } finally {
      setActing(false);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading transfer requests...</div>;

  const pendingCount = (requests as any[]).filter((r: any) => r.Status === "Pending").length;

  const itemColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead ID", size: 100,
      cell: (i) => <span className="text-xs font-mono text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 150,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "Mobile", header: "Mobile", size: 110,
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue() as string}</span> },
    { accessorKey: "LeadStatus", header: "Status", size: 100,
      cell: (i) => <span className="text-xs">{i.getValue() as string}</span> },
    { accessorKey: "Classification", header: "Classification", size: 110,
      cell: (i) => (
        i.row.original.Classification ? (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
            i.row.original.Classification === "Hot" ? "bg-red-500/10 text-red-500" :
            i.row.original.Classification === "Warm" ? "bg-orange-500/10 text-orange-500" :
            "bg-blue-500/10 text-blue-500"
          }`}>{i.row.original.Classification}</span>
        ) : null
      ) },
    { accessorKey: "CurrentSalesperson", header: "Current Assignee", size: 130,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CurrentSalesperson || "—"}</span> },
    { accessorKey: "Transferred", header: "Transferred", size: 100, enableSorting: false,
      cell: (i) => (
        i.row.original.Transferred
          ? <span className="text-emerald-600 font-semibold text-xs">✓ Yes</span>
          : <span className="text-muted-foreground text-xs">—</span>
      ) },
  ];

  return (
    <SalesAutoShell title="Lead Transfer Requests" subtitle="Review and approve lead transfer requests from team leads">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-600">{pendingCount} pending</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Review and approve lead transfer requests from team leads</p>
          </div>
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            {["Pending", "Approved", "Rejected", "All"].map((s) => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filterStatus === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
            <ArrowRightLeft size={24} className="text-muted-foreground/40" />
            No {filterStatus === "All" ? "" : filterStatus.toLowerCase()} transfer requests
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
                          {statusBadge(req.Status)}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span><Clock size={10} className="inline mr-1" />{String(req.CreatedAt).slice(0, 10)}</span>
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
                >{acting ? "..." : actionDialog.action === "approve" ? "Approve & Transfer" : "Reject"}</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaLeadTransfers;
