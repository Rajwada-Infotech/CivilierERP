import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  X, User, Building2, IndianRupee, Paperclip, FileText, Upload, Download,
  Trash2, Plus, IdCard, Users2, CheckCircle2, Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/bookings";
const PAY_API = "/api/crm/payments";
const PLAN_API = "/api/crm/payment-plans";

const TABS = ["Main", "Details", "Attachments", "Invoice"] as const;
type Tab = typeof TABS[number];

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}
async function fetchScopedPlans(companyId?: number, projectId?: number): Promise<any[]> {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  if (projectId) params.set("projectId", String(projectId));
  const r = await fetchWithAuth(`${PLAN_API}?${params}`);
  return r.ok ? r.json() : [];
}
async function fetchInvoices(id: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${id}/invoices`);
  return r.ok ? r.json() : [];
}
async function fetchAttachments(id: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${id}/attachments`);
  return r.ok ? r.json() : [];
}
async function fetchOnAccount(id: number): Promise<any | null> {
  const r = await fetchWithAuth(`${PAY_API}/booking/${id}/on-account`);
  return r.ok ? r.json() : null;
}

export function CrmBookingDetail({ bookingId, onClose }: { bookingId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Main");
  const [paymentPlanId, setPaymentPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ InvoiceType: "Booking", Amount: "", InvoiceDate: "", Description: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["crm-booking-detail", bookingId],
    queryFn: () => fetchDetail(bookingId),
  });
  const booking = data?.booking;
  const customer = data?.customer;
  const paymentSummary = data?.paymentSummary || {};

  const { data: plans = [] } = useQuery({
    queryKey: ["crm-payment-plans-scoped", booking?.CompanyId, booking?.ProjectId],
    queryFn: () => fetchScopedPlans(booking?.CompanyId, booking?.ProjectId),
    enabled: !!booking,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["crm-booking-invoices", bookingId],
    queryFn: () => fetchInvoices(bookingId),
    enabled: tab === "Invoice" || tab === "Details",
  });
  const { data: onAccount } = useQuery({
    queryKey: ["crm-booking-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId),
    enabled: tab === "Details",
  });
  const { data: attachments = [] } = useQuery({
    queryKey: ["crm-booking-attachments", bookingId],
    queryFn: () => fetchAttachments(bookingId),
    enabled: tab === "Attachments",
  });

  const effectivePlanId = paymentPlanId ?? (booking?.PaymentPlanId ? String(booking.PaymentPlanId) : "");

  const handleSaveMain = async () => {
    const currentPlanId = booking?.PaymentPlanId ? String(booking.PaymentPlanId) : "";
    if (effectivePlanId !== currentPlanId) {
      const ok = window.confirm(
        "Changing the payment plan will regenerate this booking's entire payment milestone schedule from the new plan (it's blocked automatically if any payment has already been recorded). Continue?"
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PaymentPlanId: effectivePlanId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.milestonesRegenerated ? "Payment plan updated — milestone schedule regenerated" : "Payment plan updated");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
      qc.invalidateQueries({ queryKey: ["crm-milestones", String(bookingId)] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetchWithAuth(`${API}/${bookingId}/attachments`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("File(s) uploaded");
      qc.invalidateQueries({ queryKey: ["crm-booking-attachments", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/attachments/${attId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Attachment removed");
      qc.invalidateQueries({ queryKey: ["crm-booking-attachments", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openInvoiceDialog = () => {
    setInvoiceForm({ InvoiceType: "Booking", Amount: booking?.BookingAmount ? String(booking.BookingAmount) : "", InvoiceDate: "", Description: "" });
    setInvoiceDialog(true);
  };

  const handleGenerateInvoice = async () => {
    if (!invoiceForm.Amount) { toast.error("Amount is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...invoiceForm, Amount: parseFloat(invoiceForm.Amount) }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(`Invoice ${resData.InvoiceNo} generated — visible to the customer in their portal`);
      setInvoiceDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-booking-invoices", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Building2 size={16} className="text-primary" />
            {booking ? `${booking.BookingNo} — ${booking.ApplicantName}` : "Booking Detail"}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !booking ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-border">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>
                  {t}
                </button>
              ))}
            </div>

            {/* ── Tab 1: Main ── */}
            {tab === "Main" && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Application</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.ApplicationNo}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Company</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.CompanyName || "—"}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Project</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.ProjectName || "—"}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Unit / Block</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{[booking.UnitNo, booking.BlockName].filter(Boolean).join(" / ") || "—"}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Payment Plan</label>
                    <select value={effectivePlanId} onChange={(e) => setPaymentPlanId(e.target.value)}
                      className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                      <option value="">— No plan (7-stage default) —</option>
                      {(plans as any[]).map((p: any) => (
                        <option key={p.Id} value={String(p.Id)}>{p.PlanName}{!p.CompanyId && !p.ProjectId ? " (Global)" : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleSaveMain} disabled={saving || paymentPlanId === null}
                    className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                    {saving ? "Saving..." : "Save Payment Plan"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab 2: Details ── */}
            {tab === "Details" && (
              <div className="space-y-4 pt-2">
                {customer && (
                  <div className="rounded-xl border border-border p-3.5">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><IdCard size={13} /> Customer</h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div><span className="text-muted-foreground block">Name</span><span className="font-medium">{customer.CustomerName}</span></div>
                      <div><span className="text-muted-foreground block">Mobile</span><span className="font-medium">{customer.Mobile}{customer.AltMobile ? ` / ${customer.AltMobile}` : ""}</span></div>
                      <div><span className="text-muted-foreground block">Email</span><span className="font-medium">{customer.Email || "—"}</span></div>
                      <div><span className="text-muted-foreground block">PAN</span><span className="font-medium font-mono">{customer.PanNo || "—"}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block">Address</span><span className="font-medium">{customer.Address || "—"}{[customer.City, customer.State, customer.Pincode].filter(Boolean).length ? ` · ${[customer.City, customer.State, customer.Pincode].filter(Boolean).join(", ")}` : ""}</span></div>
                      {customer.CoApplicantName && (
                        <div className="col-span-2 pt-1 border-t border-border/60 flex items-center gap-1.5">
                          <Users2 size={11} className="text-muted-foreground" />
                          <span className="text-muted-foreground">Co-Applicant:</span>
                          <span className="font-medium">{customer.CoApplicantName}{customer.CoApplicantRelation ? ` (${customer.CoApplicantRelation})` : ""} — {customer.CoApplicantMobile || "—"}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border p-3.5">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><Building2 size={13} /> Booking</h3>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                    <div><span className="text-muted-foreground block">Unit</span><span className="font-medium">{booking.UnitNo || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Block</span><span className="font-medium">{booking.BlockName || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Floor</span><span className="font-medium">{booking.FloorName || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Area</span><span className="font-medium">{booking.AreaSqFt ? `${booking.AreaSqFt} sqft` : "—"}</span></div>
                    <div><span className="text-muted-foreground block">Rate / sqft</span><span className="font-medium">{fmt(booking.RatePerSqFt)}</span></div>
                    <div><span className="text-muted-foreground block">Booking Date</span><span className="font-medium">{booking.BookingDate ? String(booking.BookingDate).slice(0, 10) : "—"}</span></div>
                    <div><span className="text-muted-foreground block">Total Value</span><span className="font-semibold">{fmt(booking.TotalValue)}</span></div>
                    <div><span className="text-muted-foreground block">Booking Amount</span><span className="font-semibold">{fmt(booking.BookingAmount)}</span></div>
                    <div><span className="text-muted-foreground block">Token</span><span className="font-medium">{booking.TokenType === "Percentage" ? `${booking.TokenValue}%` : fmt(booking.TokenValue)}</span></div>
                    <div><span className="text-muted-foreground block">Parking</span><span className="font-medium">{fmt(booking.ParkingTotal)}</span></div>
                    <div><span className="text-muted-foreground block">Extra Charges</span><span className="font-medium">{fmt(booking.ExtraChargesTotal)}</span></div>
                    <div><span className="text-muted-foreground block">Grand Total</span><span className="font-bold text-primary">{fmt(booking.GrandTotal)}</span></div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3.5 ${paymentSummary.balance > 0 ? "border-amber-200 bg-amber-50/40" : "border-border"}`}>
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><IndianRupee size={13} /> Payment Summary</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-muted-foreground block">Total Due</span><span className="font-semibold">{fmt(paymentSummary.totalDue)}</span></div>
                    <div><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-green-700">{fmt(paymentSummary.totalPaid)}</span></div>
                    <div><span className="text-muted-foreground block">Balance</span><span className="font-semibold text-amber-700">{fmt(paymentSummary.balance)}</span></div>
                  </div>
                  {onAccount?.availableBalance > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium mt-2 pt-2 border-t border-border/60">
                      <Wallet size={12} /> {fmt(onAccount.availableBalance)} sitting on account, not yet applied to a milestone
                    </div>
                  )}
                </div>

                {invoices.length > 0 && (
                  <div className="rounded-xl border border-border p-3.5">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><FileText size={13} /> Invoices</h3>
                    <div className="space-y-1.5">
                      {invoices.map((inv: any) => (
                        <div key={inv.Id} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-primary">{inv.InvoiceNo}</span>
                          <span className="text-muted-foreground">{inv.InvoiceType}</span>
                          <span className="font-semibold">{fmt(inv.Amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 3: Attachments ── */}
            {tab === "Attachments" && (
              <div className="space-y-3 pt-2">
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-6 cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors">
                  <Upload size={16} className="text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Click to upload files (PDF, images, Office docs — up to 25MB each)"}</span>
                  <input type="file" multiple className="hidden" disabled={uploading}
                    onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
                </label>

                {attachments.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-sm">No attachments yet</div>
                ) : (
                  <div className="space-y-2">
                    {(attachments as any[]).map((a: any) => (
                      <div key={a.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip size={14} className="text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{a.Label || a.FileName}</div>
                            <div className="text-[11px] text-muted-foreground">{a.FileName} · {a.FileSize ? `${(a.FileSize / 1024).toFixed(0)} KB` : ""} · {a.UploadedByName || "—"}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a href={`${API}/${bookingId}/attachments/file/${a.Id}`} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><Download size={14} /></a>
                          <button onClick={() => handleDeleteAttachment(a.Id)} className="p-1.5 rounded-md hover:bg-rose-50 text-muted-foreground hover:text-rose-600">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 4: Invoice ── */}
            {tab === "Invoice" && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Every invoice generated here is immediately visible to the customer in their portal.</p>
                  <button onClick={openInvoiceDialog}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 shrink-0">
                    <Plus size={14} /> Generate Invoice
                  </button>
                </div>

                {invoices.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">No invoices generated yet</div>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-left">
                          {["Invoice No", "Type", "Amount", "Date", "Status", "By"].map((h) => (
                            <th key={h} className="px-3 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(invoices as any[]).map((inv: any) => (
                          <tr key={inv.Id} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{inv.InvoiceNo}</td>
                            <td className="px-3 py-2 text-xs">{inv.InvoiceType}</td>
                            <td className="px-3 py-2 font-semibold">{fmt(inv.Amount)}</td>
                            <td className="px-3 py-2 text-xs">{String(inv.InvoiceDate).slice(0, 10)}</td>
                            <td className="px-3 py-2">
                              <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200 flex items-center gap-1 w-fit">
                                <CheckCircle2 size={10} /> {inv.Status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{inv.CreatedByName || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>

      {/* Generate Invoice Dialog */}
      <Dialog open={invoiceDialog} onOpenChange={(o) => { if (!o) setInvoiceDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><FileText size={16} className="text-primary" /> Generate Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Invoice Type</label>
              <select value={invoiceForm.InvoiceType} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="Booking">Booking</option>
                <option value="Agreement">Agreement</option>
                <option value="Possession">Possession</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Amount (₹) *</label>
              <input type="number" value={invoiceForm.Amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, Amount: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Invoice Date</label>
              <input type="date" value={invoiceForm.InvoiceDate} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <textarea value={invoiceForm.Description} onChange={(e) => setInvoiceForm((f) => ({ ...f, Description: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setInvoiceDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleGenerateInvoice} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Generating..." : "Generate"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
