import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { formatINR } from "@/utils/formatCurrency";
import { Plus, AlertTriangle, CheckCircle2, Landmark, Pencil, Lock, ShieldCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/noc";
const BKG_API = "/api/crm/bookings";

const NOC_TYPES = ["Organisation", "Bank"];

// Pending -> Approved -> Issued is the only forward path; Rejected can be
// resubmitted back to Pending. Issued is genuinely terminal — there is no
// backend route that moves a NOC off Issued (see crmNoc.js PUT /:id/submit,
// which only ever transitions Rejected -> Pending). A shared ApprovalActions
// component elsewhere treats "Issued" as resubmittable for other modules'
// vocabulary; that doesn't apply here, so this page never renders it once a
// NOC reaches Issued — the real bug behind "Cannot submit from status Issued".
const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Pending:  { text: "text-amber-700",   bar: "bg-amber-500" },
  Approved: { text: "text-blue-700",    bar: "bg-blue-500" },
  Issued:   { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected: { text: "text-rose-700",    bar: "bg-rose-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading shrink-0">{label}</span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

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
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [markingIssued, setMarkingIssued] = useState(false);
  // Auto-fetched bank fields are locked (read-only) by default — they come
  // from a trusted source (KYC + real payment ledger), not free-typed, so
  // locking prevents an accidental edit that silently drifts from the
  // source of truth. Staff can still unlock to correct it (e.g. the loan
  // bank genuinely differs from the customer's personal on-file bank).
  const [bankFieldsLocked, setBankFieldsLocked] = useState(true);

  const { data: nocs = [], isLoading } = useQuery({ queryKey: ["crm-noc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });
  const hasAgreement = !!context?.agreement;
  const canRequest = !!form.BookingId && hasAgreement && !contextLoading;

  const detail = detailId != null ? (nocs as any[]).find((n: any) => n.Id === detailId) : null;

  // Deep-link from Legal Milestones: pre-fill Request NOC with this booking
  // if it doesn't have a Bank NOC yet.
  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen) return;
    const hasBankNoc = (nocs as any[]).some((n: any) => String(n.BookingId) === deepLinkBookingId && n.NocType === "Bank");
    if (hasBankNoc) return;
    if ((bookings as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setForm((f) => ({ ...f, BookingId: deepLinkBookingId, NocType: "Bank" }));
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, nocs.length, bookings.length]);

  // Auto-fill Bank NOC fields from the actual lender record (Home Loan
  // Tracking / CrmLoanDetail) — a Bank NOC exists for the bank that issued
  // the loan, which is a different bank from the customer's own KYC account
  // more often than not. Only fills fields still blank (never clobbers
  // something staff already typed), and leaves them blank — never guesses
  // from the customer's personal bank or the outstanding balance — when no
  // loan record exists yet for this booking.
  useEffect(() => {
    if (form.NocType !== "Bank" || !context) return;
    setForm((f) => ({
      ...f,
      BankName: f.BankName || context.loanDetail?.BankName || "",
      LoanAccountNo: f.LoanAccountNo || context.loanDetail?.LoanAccountNo || "",
      LoanAmount: f.LoanAmount || (context.loanDetail?.LoanAmount != null ? String(context.loanDetail.LoanAmount) : ""),
    }));
    setBankFieldsLocked(true);
  }, [form.NocType, context]);

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

  const handleMarkIssued = async () => {
    if (!detailId) return;
    setMarkingIssued(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/mark-issued`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("NOC marked as issued");

      const current = (nocs as any[]).find((n) => n.Id === detailId);
      const siblingsIssued = current && (nocs as any[])
        .filter((n) => n.BookingId === current.BookingId && n.Id !== detailId)
        .every((n) => n.Status === "Issued");
      if (current && siblingsIssued) {
        promptNextStep(navigate, "All NOCs for this booking are issued — handover can now proceed.", "/crm/handover", "Go to Handover");
      }

      qc.invalidateQueries({ queryKey: ["crm-noc"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setMarkingIssued(false);
    }
  };

  const nocColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "NocNo", header: "NOC No", size: 110,
      cell: (i) => (
        <button onClick={() => setDetailId(i.row.original.Id)} className="font-mono text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <button onClick={() => setDetailId(i.row.original.Id)} className="text-left hover:underline">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </button>
      ) },
    { accessorKey: "NocType", header: "Type", size: 100, cell: (i) => <span className="text-xs">{i.getValue() as string}</span> },
    { id: "bankLoan", header: "Bank / Loan", size: 140, enableSorting: false,
      cell: (i) => {
        const n = i.row.original;
        return <span className="text-xs">{n.NocType === "Bank" ? `${n.BankName || "—"} · ${n.LoanAmount ? formatINR(n.LoanAmount) : "—"}` : "—"}</span>;
      } },
    { accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { accessorKey: "IssuedDate", header: "Issued", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.IssuedDate ? String(i.row.original.IssuedDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setDetailId(i.row.original.Id)} className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

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
      <DataTable
        data={nocs as any[]}
        columns={nocColumns}
        loading={isLoading}
        emptyMessage="No NOC requests"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Request dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Request NOC</DialogTitle></DialogHeader>
          <div className="space-y-2.5">
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

            {form.BookingId && !contextLoading && context && (
              <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] leading-relaxed">
                <div className="font-medium text-foreground">
                  {context.booking.ApplicantName} <span className="text-muted-foreground font-normal">· {context.booking.Mobile} · {context.booking.BookingNo} · {context.booking.UnitNo}</span>
                </div>
                {hasAgreement ? (
                  <div className="flex items-center gap-1 text-green-700">
                    <CheckCircle2 size={11} /> {context.agreement.AgreementNo} — {context.agreement.Status}
                    {context.existingNocs?.length > 0 && (
                      <span className="text-muted-foreground">· {context.existingNocs.map((n: any) => `${n.NocType}: ${n.Status}`).join(", ")}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-red-600 font-medium">
                    <AlertTriangle size={11} /> No agreement yet — NOC cannot be requested
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
              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span className="flex items-center gap-1">
                    <Landmark size={11} /> {bankFieldsLocked ? "Auto-filled from Home Loan Tracking" : "Editing — override the auto-filled values"}
                  </span>
                  <button type="button" onClick={() => setBankFieldsLocked((l) => !l)}
                    className="flex items-center gap-1 text-primary hover:underline shrink-0">
                    {bankFieldsLocked ? <><Pencil size={10} /> Edit</> : <><Lock size={10} /> Lock</>}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" placeholder="Bank Name" value={form.BankName} readOnly={bankFieldsLocked}
                    onChange={(e) => setForm((f) => ({ ...f, BankName: e.target.value }))}
                    className={`text-sm border border-border rounded px-2 py-1.5 col-span-1 ${bankFieldsLocked ? "bg-muted/40 text-muted-foreground cursor-default" : "bg-background"}`} />
                  <input type="text" placeholder="Loan A/C No." value={form.LoanAccountNo} readOnly={bankFieldsLocked}
                    onChange={(e) => setForm((f) => ({ ...f, LoanAccountNo: e.target.value }))}
                    className={`text-sm border border-border rounded px-2 py-1.5 col-span-1 ${bankFieldsLocked ? "bg-muted/40 text-muted-foreground cursor-default" : "bg-background"}`} />
                  <input type="number" placeholder="Loan Amount" value={form.LoanAmount} readOnly={bankFieldsLocked}
                    onChange={(e) => setForm((f) => ({ ...f, LoanAmount: e.target.value }))}
                    className={`text-sm border border-border rounded px-2 py-1.5 col-span-1 ${bankFieldsLocked ? "bg-muted/40 text-muted-foreground cursor-default" : "bg-background"}`} />
                </div>
              </div>
            )}
            <div>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                placeholder="Reason / purpose (optional)"
                rows={1} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
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

      {/* Detail dialog — click a NOC to open its card, with a single
          status-appropriate action area instead of the flat table's inline
          buttons (which is what let a "Submit" button render on an already
          Issued NOC — a genuinely terminal state with no backend route back
          off it). */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          {detail && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ShieldCheck size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.NocNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">{detail.NocType} NOC</DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={detail.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 py-5 space-y-5">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{detail.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detail.BookingNo} · {detail.UnitNo} · {detail.Mobile}</p>
                </div>

                <div>
                  <DetailRow label="NOC Date" value={fmtDate(detail.NocDate)} />
                  {detail.NocType === "Bank" && (
                    <>
                      <DetailRow label="Bank Name" value={detail.BankName || "—"} />
                      <DetailRow label="Loan Account No." value={detail.LoanAccountNo || "—"} mono />
                      <DetailRow label="Loan Amount" value={detail.LoanAmount ? formatINR(detail.LoanAmount) : "—"} mono />
                    </>
                  )}
                  <DetailRow label="Reason" value={detail.Reason || "—"} />
                  {detail.IssuedDate && <DetailRow label="Issued Date" value={fmtDate(detail.IssuedDate)} />}
                </div>

                <div>
                  {detail.Status === "Issued" ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                      <CheckCircle2 size={16} /> Issued on {fmtDate(detail.IssuedDate)} — no further action needed
                    </div>
                  ) : detail.Status === "Pending" ? (
                    <div className="text-xs text-muted-foreground">Pending admin approval</div>
                  ) : detail.Status === "Approved" ? (
                    <button onClick={handleMarkIssued} disabled={markingIssued}
                      className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                      {markingIssued ? "Marking..." : "Mark Issued"}
                    </button>
                  ) : detail.Status === "Rejected" ? (
                    <ApprovalActions
                      status={detail.Status}
                      recordId={detail.Id}
                      endpoint={API}
                      submitOnly
                      onSuccess={() => { qc.invalidateQueries({ queryKey: ["crm-noc"] }); setDetailId(null); }}
                    />
                  ) : null}
                </div>
              </div>

              <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
                <button onClick={() => setDetailId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Close</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmNoc;
