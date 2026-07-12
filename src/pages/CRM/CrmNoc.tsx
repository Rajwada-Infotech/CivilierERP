import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";

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
async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const CrmNoc: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: nocs = [], isLoading } = useQuery({ queryKey: ["crm-noc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });
  const hasAgreement = !!context?.agreement;
  const canRequest = !!form.BookingId && hasAgreement && !contextLoading;

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!hasAgreement) { toast.error("This booking has no agreement yet — NOC cannot be requested"); return; }
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

      const current = (nocs as any[]).find((n) => n.Id === id);
      const siblingsIssued = current && (nocs as any[])
        .filter((n) => n.BookingId === current.BookingId && n.Id !== id)
        .every((n) => n.Status === "Issued");
      if (current && siblingsIssued) {
        promptNextStep(navigate, "All NOCs for this booking are issued — handover can now proceed.", "/crm/handover", "Go to Handover");
      }

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

            {form.BookingId && contextLoading && (
              <div className="text-xs text-muted-foreground px-1">Loading booking details...</div>
            )}

            {form.BookingId && !contextLoading && context && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{context.booking.ApplicantName}</span>
                  <span className="text-muted-foreground">{context.booking.Mobile}</span>
                </div>
                <div className="text-muted-foreground">{context.booking.BookingNo} · {context.booking.UnitNo}</div>

                {hasAgreement ? (
                  <div className="flex items-center gap-1.5 text-green-700">
                    <CheckCircle2 size={13} />
                    Agreement {context.agreement.AgreementNo} — {context.agreement.Status}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-red-600 font-medium">
                    <AlertTriangle size={13} />
                    No agreement yet — NOC cannot be requested for this booking
                  </div>
                )}

                {context.existingNocs?.length > 0 && (
                  <div className="pt-1 border-t border-border/60">
                    <span className="text-muted-foreground">Existing NOCs: </span>
                    {context.existingNocs.map((n: any) => (
                      <span key={n.Id} className="inline-block mr-1.5 px-1.5 py-0.5 rounded border border-border">{n.NocType} · {n.Status}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">NOC Type</label>
              <select value={form.NocType} onChange={(e) => setForm((f) => ({ ...f, NocType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {NOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            {form.NocType === "Bank" && (
              <>
                {context?.customerBankDetail?.BankName && (
                  <button type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      BankName: context.customerBankDetail.BankName || f.BankName,
                      LoanAccountNo: context.customerBankDetail.AccountNo || f.LoanAccountNo,
                    }))}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <Landmark size={12} /> Use customer's on-file bank ({context.customerBankDetail.BankName}) — verify this matches their loan bank
                  </button>
                )}
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
            <button onClick={handleCreate} disabled={saving || !canRequest}
              title={!canRequest && form.BookingId ? "This booking has no agreement yet" : undefined}
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
