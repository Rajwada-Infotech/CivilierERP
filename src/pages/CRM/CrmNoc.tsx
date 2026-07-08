import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";

const API = "/api/crm/noc";
const BKG_API = "/api/crm/bookings";

const NOC_TYPES = ["Organisation", "Bank"];
const statusColor: Record<string, string> = {
  Pending:  "text-orange-600 bg-orange-50 border-orange-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Issued:   "text-green-600 bg-green-50 border-green-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_FORM = { BookingId: "", NocType: "Organisation", NocDate: "", Reason: "", BankName: "", LoanAccountNo: "", LoanAmount: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmNoc: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: nocs = [], isLoading } = useQuery({ queryKey: ["crm-noc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), LoanAmount: form.LoanAmount || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`NOC ${data.NocNo} requested`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-noc"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkIssued = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-issued`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("NOC marked as issued");
      qc.invalidateQueries({ queryKey: ["crm-noc"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — NOC (Organisation & Bank)"
      subtitle="No-objection certificates and bank loan sanction/disbursement tracking"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Request NOC
        </button>
      }
    >
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-left">
              {["NOC No", "Customer", "Type", "Bank / Loan", "Status", "Issued", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
            ) : nocs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No NOC requests</td></tr>
            ) : (nocs as any[]).map((n: any) => (
              <tr key={n.Id} className="border-t border-border hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{n.NocNo}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{n.ApplicantName}</div>
                  <div className="text-xs text-muted-foreground">{n.BookingNo} · {n.UnitNo}</div>
                </td>
                <td className="px-4 py-3 text-xs">{n.NocType}</td>
                <td className="px-4 py-3 text-xs">
                  {n.NocType === "Bank" ? `${n.BankName || "—"} · ₹${n.LoanAmount?.toLocaleString("en-IN") || "—"}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[n.Status] || ""}`}>{n.Status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{n.IssuedDate ? String(n.IssuedDate).slice(0,10) : "—"}</td>
                <td className="px-4 py-3">
                  {/* submitOnly: Approve/Reject only ever happen from the Admin
                      Approval Inbox (admin/super_admin/marketing_head) */}
                  <ApprovalActions
                    status={n.Status}
                    recordId={n.Id}
                    endpoint={API}
                    submitOnly
                    onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-noc"] })}
                  />
                  {n.Status === "Pending" && <span className="text-xs text-muted-foreground">Pending admin approval</span>}
                  {n.Status === "Approved" && (
                    <button onClick={() => handleMarkIssued(n.Id)} className="text-xs text-primary hover:underline">Mark Issued</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Request NOC</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">NOC Type</label>
              <select value={form.NocType} onChange={(e) => setForm((f) => ({ ...f, NocType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {NOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            {form.NocType === "Bank" && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Bank Name</label>
                  <input type="text" value={form.BankName} onChange={(e) => setForm((f) => ({ ...f, BankName: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Loan A/C No.</label>
                    <input type="text" value={form.LoanAccountNo} onChange={(e) => setForm((f) => ({ ...f, LoanAccountNo: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Loan Amount</label>
                    <input type="number" value={form.LoanAmount} onChange={(e) => setForm((f) => ({ ...f, LoanAmount: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason / Purpose</label>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Requesting..." : "Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmNoc;
