import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, IndianRupee, AlertCircle, CheckCircle2, Clock, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";

const API = "/api/crm/payments";
const BKG_API = "/api/crm/bookings";

const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];

const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  Paid:    "text-green-600 bg-green-50 border-green-200",
  Overdue: "text-red-600 bg-red-50 border-red-200",
  Waived:  "text-muted-foreground bg-muted/50 border-border",
};
const statusIcon: Record<string, React.ReactNode> = {
  Pending: <Clock size={12} />,
  Paid:    <CheckCircle2 size={12} />,
  Overdue: <AlertCircle size={12} />,
  Waived:  <CheckCircle2 size={12} />,
};

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const pct = (paid: number, due: number) =>
  due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;

async function fetchMilestones(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmPaymentMilestones: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bkgParam = sp.get("bookingId") || "";
  const [selectedBookingId, setSelectedBookingId] = useState(bkgParam);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState({ AmountPaid: "", PaidDate: "", PaymentMode: "", TransactionRef: "", Remarks: "" });
  const [saving, setSaving] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });

  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings-dropdown"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: milestoneData, isLoading } = useQuery({
    queryKey: ["crm-milestones", selectedBookingId],
    queryFn: () => fetchMilestones(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 30_000,
  });

  const milestones: any[] = milestoneData?.milestones || [];
  const summary = milestoneData?.summary || {};
  const booking = milestoneData?.booking || null;

  const handleOpenPayment = (m: any) => {
    setEditingId(m.Id);
    setPayForm({
      AmountPaid: m.AmountPaid != null ? String(m.AmountPaid) : "",
      PaidDate: m.PaidDate ? String(m.PaidDate).slice(0, 10) : "",
      PaymentMode: m.PaymentMode || "",
      TransactionRef: m.TransactionRef || "",
      Remarks: m.Remarks || "",
    });
  };

  const handleWaive = async (m: any) => {
    const reason = window.prompt("Reason for waiving this milestone:");
    if (!reason) return;
    try {
      const res = await fetchWithAuth(`${API}/${m.Id}/waive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone waived");

      const allOthersCleared = milestones.filter((x) => x.Id !== m.Id).every((x) => ["Paid", "Waived"].includes(x.Status));
      if (allOthersCleared) {
        promptNextStep(navigate, "All payment milestones are cleared — the Sales Deed is ready to prepare.", "/crm/sales-deed", "Go to Sales Deed");
      }

      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRecordPayment = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AmountPaid:    payForm.AmountPaid    ? parseFloat(payForm.AmountPaid) : undefined,
          PaidDate:      payForm.PaidDate      || undefined,
          PaymentMode:   payForm.PaymentMode   || undefined,
          TransactionRef:payForm.TransactionRef|| undefined,
          Remarks:       payForm.Remarks       || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Payment recorded");

      const current = milestones.find((m) => m.Id === editingId);
      const paidAmt = payForm.AmountPaid ? parseFloat(payForm.AmountPaid) : current?.AmountPaid;
      const thisOneCleared = current && paidAmt != null && paidAmt >= current.AmountDue;
      const allOthersCleared = milestones.filter((m) => m.Id !== editingId).every((m) => ["Paid", "Waived"].includes(m.Status));
      if (thisOneCleared && allOthersCleared) {
        promptNextStep(navigate, "All payment milestones are cleared — the Sales Deed is ready to prepare.", "/crm/sales-deed", "Go to Sales Deed");
      }

      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddMilestone = async () => {
    if (!selectedBookingId || !addForm.MilestoneName.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${selectedBookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MilestoneName: addForm.MilestoneName,
          DueDate: addForm.DueDate || null,
          AmountDue: addForm.AmountDue ? parseFloat(addForm.AmountDue) : 0,
          ResponsibleDepartment: addForm.ResponsibleDepartment || null,
          RequiredDocuments: addForm.RequiredDocuments || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Milestone added");
      setAddDialog(false);
      setAddForm({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Payment Milestones"
      subtitle="Milestone-wise payment tracking for bookings"
    >
      {/* Booking selector */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-64">
          <label className="text-xs text-muted-foreground block mb-1">Select Booking</label>
          <select value={selectedBookingId} onChange={(e) => setSelectedBookingId(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
            <option value="">— Choose a booking —</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.Id} value={String(b.Id)}>
                {b.BookingNo} — {b.ApplicantName} · {b.UnitNo} {b.ProjectName ? `(${b.ProjectName})` : ""}
              </option>
            ))}
          </select>
        </div>
        {selectedBookingId && (
          <button onClick={() => setAddDialog(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
            <Plus size={14} /> Add Milestone
          </button>
        )}
      </div>

      {!selectedBookingId ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Select a booking to view its payment schedule</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading milestones...</div>
      ) : !milestoneData ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No milestone data found</div>
      ) : (
        <>
          {/* Summary cards */}
          {booking && (
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-foreground">{booking.ApplicantName}</div>
                  <div className="text-xs text-muted-foreground">{booking.BookingNo} · {booking.UnitNo} {booking.ProjectName ? `· ${booking.ProjectName}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Total Value</div>
                  <div className="font-bold text-foreground">{fmt(booking.TotalValue)}</div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Total Due",  value: fmt(summary.totalDue),  color: "text-foreground"  },
                  { label: "Paid",       value: fmt(summary.totalPaid), color: "text-green-600"   },
                  { label: "Balance",    value: fmt(summary.balance),   color: "text-orange-600"  },
                  { label: "Overdue",    value: `${summary.overdue || 0} milestone(s)`, color: "text-red-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg border border-border p-3 text-center">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className={`text-sm font-bold mt-0.5 ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
              {/* Progress bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Collection Progress</span>
                  <span>{pct(summary.totalPaid, summary.totalDue)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${pct(summary.totalPaid, summary.totalDue)}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Milestone table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left">
                  {["#", "Milestone", "Dept", "Due Date", "Amount Due", "Amount Paid", "Balance", "Status", "Payment Mode", "Ref", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {milestones.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground text-sm">No milestones found</td></tr>
                ) : milestones.map((m: any) => {
                  const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
                  const isOverdue = m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date();
                  const displayStatus = isOverdue && m.Status === "Pending" ? "Overdue" : m.Status;
                  return (
                    <tr key={m.Id} className={`border-t border-border hover:bg-muted/10 transition-colors ${isOverdue ? "bg-red-50/30" : ""}`}>
                      <td className="px-4 py-3 text-muted-foreground">{m.MilestoneNo}</td>
                      <td className="px-4 py-3 font-medium">
                        {m.MilestoneName}
                        {m.RequiredDocuments && (
                          <div className="text-[10px] text-muted-foreground font-normal mt-0.5" title={m.RequiredDocuments}>
                            Docs: {m.RequiredDocuments}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.ResponsibleDepartment || "—"}</td>
                      <td className="px-4 py-3 text-xs">
                        {m.DueDate ? String(m.DueDate).slice(0, 10) : "—"}
                        {isOverdue && <span className="ml-1 text-red-500 text-[10px]">OVERDUE</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold">{fmt(m.AmountDue)}</td>
                      <td className="px-4 py-3 text-green-600 font-semibold">{fmt(m.AmountPaid)}</td>
                      <td className="px-4 py-3 text-orange-600 font-semibold">{balance > 0 ? fmt(balance) : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${statusColor[displayStatus] || ""}`}>
                          {statusIcon[displayStatus]}{displayStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{m.PaymentMode || "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{m.TransactionRef || "—"}</td>
                      <td className="px-4 py-3 flex items-center gap-2 whitespace-nowrap">
                        {m.Status !== "Paid" && m.Status !== "Waived" && (
                          <>
                            <button onClick={() => handleOpenPayment(m)}
                              className="text-xs text-primary hover:underline">
                              Record Payment
                            </button>
                            <button onClick={() => handleWaive(m)}
                              className="text-xs text-muted-foreground hover:underline">
                              Waive
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Record Payment Dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "AmountPaid",    label: "Amount Paid (₹)", type: "number" },
                { key: "PaidDate",      label: "Payment Date",     type: "date"   },
                { key: "TransactionRef",label: "Transaction Ref",  type: "text"   },
              ].map(({ key, label, type }) => (
                <div key={key} className={key === "TransactionRef" ? "col-span-2" : ""}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={payForm[key as keyof typeof payForm]}
                    onChange={(e) => setPayForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                <select value={payForm.PaymentMode} onChange={(e) => setPayForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select mode</option>
                  {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
                <textarea value={payForm.Remarks} onChange={(e) => setPayForm((f) => ({ ...f, Remarks: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setEditingId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRecordPayment} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Record Payment"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Milestone Dialog */}
      <Dialog open={addDialog} onOpenChange={(o) => { if (!o) setAddDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Add Custom Milestone</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Milestone Name *</label>
              <input type="text" value={addForm.MilestoneName}
                onChange={(e) => setAddForm((f) => ({ ...f, MilestoneName: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. PLC Charges" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Due Date</label>
              <input type="date" value={addForm.DueDate}
                onChange={(e) => setAddForm((f) => ({ ...f, DueDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Amount Due (₹)</label>
              <input type="number" value={addForm.AmountDue}
                onChange={(e) => setAddForm((f) => ({ ...f, AmountDue: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Responsible Department</label>
              <input type="text" value={addForm.ResponsibleDepartment}
                onChange={(e) => setAddForm((f) => ({ ...f, ResponsibleDepartment: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. Construction, Legal, Sales" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Required Documents</label>
              <input type="text" value={addForm.RequiredDocuments}
                onChange={(e) => setAddForm((f) => ({ ...f, RequiredDocuments: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. Completion Certificate" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAddDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleAddMilestone} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Adding..." : "Add Milestone"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmPaymentMilestones;
