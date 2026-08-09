import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, ShieldAlert, IndianRupee, Lock, Unlock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/brokerage";
const BKG_API = "/api/crm/bookings";
const BROKER_API = "/api/account-head?type=BR";

const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Paid: "text-green-600 bg-green-50 border-green-200",
};

const EMPTY_FORM = { BookingId: "", BrokerId: "", BrokerFirm: "", RateType: "Percentage", RateValue: "", ComputedAmount: "", Notes: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBrokers(): Promise<any[]> {
  try { const r = await fetchWithAuth(BROKER_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmBrokerage: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: records = [], isLoading } = useQuery({ queryKey: ["crm-brokerage"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: brokers = [] } = useQuery({ queryKey: ["broker-master"], queryFn: fetchBrokers, staleTime: 5 * 60_000 });
  // Broker Master is the source of truth for the broker's own identity —
  // once picked, his details are only ever displayed read-only here, never
  // re-typed. Only the Firm/Rate below are genuinely per-deal fields.
  const selectedBroker = useMemo(() => (brokers as any[]).find((b: any) => String(b.LHeadId) === form.BrokerId) || null, [brokers, form.BrokerId]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.Id);
    setForm({
      BookingId: String(r.BookingId || ""),
      BrokerId: String(r.BrokerId || ""),
      BrokerFirm: r.BrokerFirm || "",
      RateType: r.RateType || "Percentage",
      RateValue: r.RateValue != null ? String(r.RateValue) : "",
      ComputedAmount: r.ComputedAmount != null ? String(r.ComputedAmount) : "",
      Notes: r.Notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingId && (!form.BookingId || !form.BrokerId || !form.RateValue)) { toast.error("Booking, broker and rate are required"); return; }
    if (editingId && (!form.RateValue || !form.ComputedAmount)) { toast.error("Rate and approved amount are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(editingId ? `${API}/${editingId}` : API, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          BookingId: form.BookingId ? parseInt(form.BookingId) : undefined,
          BrokerId: form.BrokerId ? parseInt(form.BrokerId) : undefined,
          RateValue: form.RateValue ? Number(form.RateValue) : undefined,
          ComputedAmount: form.ComputedAmount ? Number(form.ComputedAmount) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(editingId ? "Brokerage updated" : "Brokerage recorded");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span> },
    { accessorKey: "BrokerName", header: "Broker", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.BrokerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BrokerFirm || "—"}</div>
        </div>
      ) },
    { id: "rate", header: "Rate", size: 90, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.RateType === "Percentage" ? `${i.row.original.RateValue}%` : `₹${i.row.original.RateValue}`}</span> },
    { accessorKey: "MilestoneNo", header: "Tranche", size: 150, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.MilestoneNo == null) return <span className="text-xs text-muted-foreground">Full payout</span>;
        return (
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${r.IsLocked ? "text-red-600 bg-red-50 border-red-200" : "text-green-600 bg-green-50 border-green-200"}`}>
            {r.IsLocked ? <Lock size={11} /> : <Unlock size={11} />} Milestone {r.MilestoneNo}{r.MilestoneName ? ` — ${r.MilestoneName}` : ""}
          </span>
        );
      } },
    { accessorKey: "ComputedAmount", header: "Computed Amount", size: 130,
      cell: (i) => <span className="font-semibold">₹{Number(i.row.original.ComputedAmount).toLocaleString("en-IN")}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.IsLocked) {
          return <span className="flex items-center gap-1 text-xs text-red-600"><Lock size={11} /> Unlocks once Milestone {r.MilestoneNo ?? "?"} is paid</span>;
        }
        return (
          <>
            {/* submitOnly: Approve/Reject only ever happen from the Admin
                Approval Inbox (admin/super_admin/dba), never self-service here */}
            <ApprovalActions
              status={r.Status}
              recordId={r.Id}
              endpoint={API}
              submitOnly
              onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-brokerage"] })}
            />
            {r.Status === "Pending" && (
              <button onClick={() => openEdit(r)} className="text-xs text-primary hover:underline">Customize amount</button>
            )}
            {r.Status === "Approved" && (
              <button onClick={() => navigate(r.FinancePaymentId ? `/payments?id=${r.FinancePaymentId}` : "/payments")} className="text-xs text-primary hover:underline">
                {r.FinancePaymentDocNo ? `Finance: ${r.FinancePaymentDocNo}` : "Sent to Finance"}
              </button>
            )}
            {r.Status === "Paid" && <span className="text-xs text-muted-foreground">Fully paid</span>}
          </>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Brokerage"
      subtitle="Per-booking broker assignment — internal only, never shown to the customer"
      action={
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Add Broker
        </button>
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          <ShieldAlert size={14} /> This data is internal-only and is excluded from the customer portal by design.
        </div>
        <button onClick={() => navigate("/crm/broker-payments")}
          className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors">
          <IndianRupee size={14} /> Go to Broker Payment
        </button>
      </div>

      <DataTable
        data={records}
        columns={columns}
        loading={isLoading}
        emptyMessage="No brokerage records"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setEditingId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">{editingId ? "Customize Brokerage" : "Add Broker Involvement"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} disabled={!!editingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName} (₹{Number(b.TotalValue || 0).toLocaleString("en-IN")})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Broker * (from Broker Master)</label>
              <select value={form.BrokerId} disabled={!!editingId} onChange={(e) => setForm((f) => ({ ...f, BrokerId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select broker</option>
                {(brokers as any[]).map((b: any) => (
                  <option key={b.LHeadId} value={String(b.LHeadId)}>{b.LHeadName}{b.LHeadPhone ? ` — ${b.LHeadPhone}` : ""}</option>
                ))}
              </select>
              {!brokers.length && (
                <p className="text-xs text-muted-foreground mt-1">No brokers found — add one in Broker Master first.</p>
              )}
            </div>

            {selectedBroker && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-muted/20 border border-border p-2.5 text-xs">
                {selectedBroker.LHeadPhone && <div><span className="text-muted-foreground">Phone: </span><span className="font-medium">{selectedBroker.LHeadPhone}</span></div>}
                {selectedBroker.LHeadPan && <div><span className="text-muted-foreground">PAN: </span><span className="font-mono font-medium">{selectedBroker.LHeadPan}</span></div>}
                {selectedBroker.LHeadRera && <div><span className="text-muted-foreground">RERA: </span><span className="font-mono font-medium">{selectedBroker.LHeadRera}</span></div>}
                {selectedBroker.LHeadPaymentTerms && <div><span className="text-muted-foreground">Terms: </span><span className="font-medium">{selectedBroker.LHeadPaymentTerms}</span></div>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Firm (optional, for this deal)</label>
                <input type="text" value={form.BrokerFirm} onChange={(e) => setForm((f) => ({ ...f, BrokerFirm: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rate Type</label>
                <select value={form.RateType} onChange={(e) => setForm((f) => ({ ...f, RateType: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="Percentage">Percentage</option>
                  <option value="Amount">Fixed Amount</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Rate Value * ({form.RateType === "Percentage" ? "%" : "₹"})</label>
              <input type="number" value={form.RateValue} onChange={(e) => setForm((f) => ({ ...f, RateValue: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            {editingId && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Approved Amount *</label>
                <input type="number" value={form.ComputedAmount} onChange={(e) => setForm((f) => ({ ...f, ComputedAmount: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setEditingId(null); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmBrokerage;
