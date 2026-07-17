import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, IndianRupee } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/brokerage";

const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Other"];

const EMPTY_FORM = { BrokerageId: "", Amount: "", PaidDate: "", PaymentMode: "", TransactionRef: "", Notes: "" };

async function fetchPayments(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/payments`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBrokerageRecords(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmBrokerPayments: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: payments = [], isLoading } = useQuery({ queryKey: ["crm-broker-payments"], queryFn: fetchPayments, staleTime: 30_000 });
  const { data: brokerageRecords = [] } = useQuery({ queryKey: ["crm-brokerage"], queryFn: fetchBrokerageRecords, staleTime: 60_000 });

  // Only Approved (not yet fully paid) brokerage records are eligible — Pending
  // records must be approved on the Brokerage page first, and Paid ones are done.
  const payable = useMemo(() => (brokerageRecords as any[]).filter((r: any) => r.Status === "Approved"), [brokerageRecords]);

  const filtered = useMemo(() =>
    (payments as any[]).filter((p: any) =>
      !search || p.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || p.BrokerName?.toLowerCase().includes(search.toLowerCase())
        || p.BookingNo?.includes(search)
    ), [payments, search]);

  const totalPaid = filtered.reduce((s: number, p: any) => s + Number(p.Amount || 0), 0);

  const handleRecord = async () => {
    if (!form.BrokerageId || !form.Amount) { toast.error("Brokerage record and amount are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${form.BrokerageId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, Amount: parseFloat(form.Amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Broker payment recorded");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-broker-payments"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BrokerName", header: "Broker", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.BrokerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BrokerFirm || "—"}</div>
        </div>
      ) },
    { id: "bookingCustomer", header: "Booking / Customer", size: 150, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="font-mono text-xs">{i.row.original.BookingNo}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.ApplicantName}</div>
        </div>
      ) },
    { accessorKey: "Amount", header: "Amount", size: 110, cell: (i) => <span className="font-semibold text-green-600">₹{Number(i.row.original.Amount).toLocaleString("en-IN")}</span> },
    { accessorKey: "PaidDate", header: "Paid Date", size: 100, cell: (i) => <span className="text-xs">{i.row.original.PaidDate ? String(i.row.original.PaidDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "PaymentMode", header: "Mode", size: 90, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "TransactionRef", header: "Ref", size: 110, cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "CreatedByName", header: "Recorded By", size: 110, cell: (i) => <span className="text-xs text-muted-foreground">{(i.getValue() as string) || "—"}</span> },
  ];

  return (
    <SalesAutoShell
      title="CRM — Broker Payment"
      subtitle="Payouts against recorded brokerage — separate from Broker Master and Brokerage assignment"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Record Payment
        </button>
      }
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search broker, customer, booking..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-1.5 text-sm bg-muted/30 border border-border rounded-lg px-3 py-2">
          <IndianRupee size={14} className="text-muted-foreground" />
          <span className="text-muted-foreground">Total shown:</span>
          <span className="font-semibold">₹{totalPaid.toLocaleString("en-IN")}</span>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No broker payments recorded"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Record Broker Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Brokerage Record *</label>
              <select value={form.BrokerageId} onChange={(e) => setForm((f) => ({ ...f, BrokerageId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select brokerage record</option>
                {(payable as any[]).map((r: any) => (
                  <option key={r.Id} value={String(r.Id)}>
                    {r.BrokerName} — {r.BookingNo} — Due ₹{Number(r.ComputedAmount).toLocaleString("en-IN")}
                  </option>
                ))}
              </select>
              {!payable.length && (
                <p className="text-xs text-muted-foreground mt-1">No approved brokerage records awaiting payment — approve one on the Brokerage page first.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Amount *</label>
                <input type="number" value={form.Amount} onChange={(e) => setForm((f) => ({ ...f, Amount: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Paid Date</label>
                <input type="date" value={form.PaidDate} onChange={(e) => setForm((f) => ({ ...f, PaidDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                <select value={form.PaymentMode} onChange={(e) => setForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select</option>
                  {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Transaction Ref</label>
                <input type="text" value={form.TransactionRef} onChange={(e) => setForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRecord} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Recording..." : "Record Payment"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmBrokerPayments;
