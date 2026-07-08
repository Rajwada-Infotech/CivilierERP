import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, IndianRupee } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-left">
              {["Broker", "Booking / Customer", "Amount", "Paid Date", "Mode", "Ref", "Recorded By"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No broker payments recorded</td></tr>
            ) : (filtered as any[]).map((p: any) => (
              <tr key={p.Id} className="border-t border-border hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.BrokerName}</div>
                  <div className="text-xs text-muted-foreground">{p.BrokerFirm || "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs">{p.BookingNo}</div>
                  <div className="text-xs text-muted-foreground">{p.ApplicantName}</div>
                </td>
                <td className="px-4 py-3 font-semibold text-green-600">₹{Number(p.Amount).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-xs">{p.PaidDate ? String(p.PaidDate).slice(0,10) : "—"}</td>
                <td className="px-4 py-3 text-xs">{p.PaymentMode || "—"}</td>
                <td className="px-4 py-3 text-xs font-mono">{p.TransactionRef || "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.CreatedByName || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
