import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, Download, Search, ExternalLink, Plus, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/invoices";
const BKG_API = "/api/crm/bookings";
const PAY_API = "/api/crm/payments";

interface InvoiceRow {
  Id: number;
  InvoiceNo: string;
  InvoiceType: string;
  Amount: number;
  InvoiceDate: string;
  Status: string;
  CreatedAt: string;
  BookingId: number;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedByName: string | null;
}

const TYPES = ["Milestone", "Maintenance", "Other", "OnAccount", "Agreement", "Possession"];

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN");
}

async function fetchInvoices(type: string, search: string): Promise<InvoiceRow[]> {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (search) q.set("search", search);
  const res = await fetchWithAuth(`${API}?${q}`);
  if (!res.ok) throw new Error("Failed to load invoices");
  return res.json();
}

async function fetchBookingsForPicker(): Promise<any[]> {
  const res = await fetchWithAuth(BKG_API);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.bookings || [];
}

async function fetchBookingDetail(id: number): Promise<any | null> {
  const res = await fetchWithAuth(`${BKG_API}/${id}`);
  return res.ok ? res.json() : null;
}

async function fetchOnAccount(id: number): Promise<any | null> {
  const res = await fetchWithAuth(`${PAY_API}/booking/${id}/on-account`);
  return res.ok ? res.json() : null;
}

function InvoicePreviewDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${BKG_API}/${invoice.BookingId}/invoices/${invoice.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.BookingId, invoice.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2"><FileText size={16} className="text-primary" /> {invoice.InvoiceNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 rounded-lg overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
        <div className="text-xs text-muted-foreground pt-1">{invoice.InvoiceType} · {fmtMoney(invoice.Amount)} · {invoice.BookingNo}</div>
      </DialogContent>
    </Dialog>
  );
}

// Single card, no tabs: one free-text search plus three optional
// Company/Project/Block narrowing filters, all applied together over the
// one bookings list — whichever combination the person generating the
// invoice reaches for (typing a name, or drilling down a project) lands in
// the same result list. Selecting a booking auto-backfills Company/
// Project/Block/Unit/Customer and shows its full Payment Plan with each
// milestone's status right there, so picking what to invoice against means
// looking at real numbers, not guessing from a bare dropdown. Numbering is
// three-way: auto (INV-YYYY-NNNNN), a custom prefix that still auto-
// increments, or one fully custom number.
function GenerateInvoiceDialog({ initialBookingId, onClose, onGenerated }: { initialBookingId: number | null; onClose: () => void; onGenerated: () => void }) {
  const [bookingId, setBookingId] = useState<number | null>(initialBookingId);
  const [bookingSearch, setBookingSearch] = useState("");
  // Classic drill-down: Company -> Project -> Block. Built entirely from
  // the already-fetched bookings list (every booking carries its own
  // CompanyId/ProjectId/BlockId + names) rather than hitting three more
  // master-data endpoints — one fetch, filtered views over it, combined
  // with the free-text search rather than switching between them.
  const [hCompanyId, setHCompanyId] = useState("");
  const [hProjectId, setHProjectId] = useState("");
  const [hBlockId, setHBlockId] = useState("");
  const [form, setForm] = useState({
    InvoiceType: "Milestone", MilestoneId: "", OnAccountPaymentId: "", Amount: "", InvoiceDate: new Date().toLocaleDateString("en-CA"), Description: "",
    NumberMode: "auto" as "auto" | "prefix" | "custom", InvoicePrefix: "", CustomInvoiceNo: "",
  });
  const [saving, setSaving] = useState(false);

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery({
    queryKey: ["crm-bookings-for-invoice-picker"],
    queryFn: fetchBookingsForPicker,
    enabled: !bookingId,
    staleTime: 60_000,
  });
  const { data: bookingDetail } = useQuery({
    queryKey: ["crm-invoice-gen-booking-detail", bookingId],
    queryFn: () => fetchBookingDetail(bookingId as number),
    enabled: !!bookingId,
  });
  const { data: onAccountData } = useQuery({
    queryKey: ["crm-invoice-gen-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId as number),
    enabled: !!bookingId,
  });
  const { data: existingInvoices = [] } = useQuery({
    queryKey: ["crm-invoice-gen-existing", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`);
      return r.ok ? r.json() : [];
    },
    enabled: !!bookingId,
  });

  const booking = bookingDetail?.booking;
  const milestones: any[] = bookingDetail?.milestones || [];
  const eligibleMilestones = milestones.filter(
    (m) => Number(m.MilestoneNo) !== 1 && m.Status === "Paid" && m.DemandStatus !== "Pending"
      && !existingInvoices.some((inv: any) => inv.MilestoneId === m.Id)
  );
  const eligibleOnAccount = (onAccountData?.payments || []).filter(
    (p: any) => !p.InvoiceId && !existingInvoices.some((inv: any) => inv.OnAccountPaymentId === p.Id)
  );

  // Once this booking's eligibility is known, land on whichever type
  // actually has something to invoice instead of defaulting to "Milestone"
  // and showing an empty-state message for a booking that has none.
  useEffect(() => {
    if (!booking) return;
    if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length > 0) {
      setForm((f) => ({ ...f, InvoiceType: "OnAccount" }));
    } else if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length === 0) {
      setForm((f) => ({ ...f, InvoiceType: "Maintenance" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, eligibleMilestones.length, eligibleOnAccount.length]);

  // Distinct-value cascades for the three narrowing filters, each scoped by
  // whatever's already picked above it — Company first, then only that
  // company's Projects, then only that project's Blocks. These apply
  // together with the free-text search below, not instead of it.
  function distinctBy(list: any[], idKey: string, nameKey: string) {
    const seen = new Map<string, string>();
    for (const b of list) {
      const id = b[idKey];
      if (id == null || seen.has(String(id))) continue;
      seen.set(String(id), b[nameKey] || `#${id}`);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }
  const hCompanies = useMemo(() => distinctBy(bookings, "CompanyId", "CompanyName"), [bookings]);
  const hProjectPool = useMemo(() => hCompanyId ? bookings.filter((b: any) => String(b.CompanyId) === hCompanyId) : bookings, [bookings, hCompanyId]);
  const hProjects = useMemo(() => distinctBy(hProjectPool, "ProjectId", "ProjectName"), [hProjectPool]);
  const hBlockPool = useMemo(() => hProjectId ? hProjectPool.filter((b: any) => String(b.ProjectId) === hProjectId) : hProjectPool, [hProjectPool, hProjectId]);
  const hBlocks = useMemo(() => distinctBy(hBlockPool, "BlockId", "BlockName"), [hBlockPool]);

  // The one result list — free-text search AND the three hierarchy filters
  // all apply together (search narrows within whatever Company/Project/
  // Block is picked, not separately from it).
  const filteredBookings = useMemo(() => {
    let list = hBlockId ? hBlockPool.filter((b: any) => String(b.BlockId) === hBlockId) : hBlockPool;
    const q = bookingSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((b: any) =>
        String(b.BookingNo || "").toLowerCase().includes(q)
        || String(b.ApplicantName || "").toLowerCase().includes(q)
        || String(b.Mobile || "").toLowerCase().includes(q)
        || String(b.ProjectName || "").toLowerCase().includes(q)
        || String(b.UnitNo || "").toLowerCase().includes(q));
    }
    return list.slice(0, 40);
  }, [hBlockPool, hBlockId, bookingSearch]);

  async function handleGenerate() {
    if (form.InvoiceType === "Milestone" && !form.MilestoneId) { toast.error("Select a milestone"); return; }
    if (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId) { toast.error("Select an on-account payment"); return; }
    if (!["Milestone", "OnAccount"].includes(form.InvoiceType) && !form.Amount) { toast.error("Amount is required"); return; }
    if (form.NumberMode === "prefix" && !form.InvoicePrefix.trim()) { toast.error("Enter a prefix, or switch to Auto"); return; }
    if (form.NumberMode === "custom" && !form.CustomInvoiceNo.trim()) { toast.error("Enter the invoice number, or switch to Auto"); return; }
    setSaving(true);
    try {
      const body: any = {
        InvoiceType: form.InvoiceType, Description: form.Description,
        InvoicePrefix: form.NumberMode === "prefix" ? form.InvoicePrefix.trim() : undefined,
        CustomInvoiceNo: form.NumberMode === "custom" ? form.CustomInvoiceNo.trim() : undefined,
      };
      if (form.InvoiceType === "Milestone") body.MilestoneId = parseInt(form.MilestoneId);
      else if (form.InvoiceType === "OnAccount") body.OnAccountPaymentId = parseInt(form.OnAccountPaymentId);
      else { body.Amount = parseFloat(form.Amount); body.InvoiceDate = form.InvoiceDate; }
      const res = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate invoice");
      toast.success(`Invoice ${data.InvoiceNo} generated`);
      onGenerated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Milestone status pill styling, shared by the payment-plan table below.
  function milestoneStatusPill(m: any) {
    if (m.Status === "Paid") return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-emerald-700 bg-emerald-50 border-emerald-200">Paid</span>;
    if (m.Status === "Waived") return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40 border-border">Waived</span>;
    if (Number(m.AmountPaid) > 0) return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-amber-700 bg-amber-50 border-amber-200">Partially Paid</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40 border-border">Pending</span>;
  }
  function milestoneIneligibleReason(m: any) {
    if (Number(m.MilestoneNo) === 1) return "Booking Amount — generated from the Booking page";
    if (m.Status !== "Paid" && m.Status !== "Waived") return "Not fully paid yet";
    if (m.DemandStatus === "Pending") return "Demand not raised yet";
    if (existingInvoices.some((inv: any) => inv.MilestoneId === m.Id)) return "Already invoiced";
    return null;
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto thin-scroll">
        <DialogHeader><DialogTitle className="font-heading">Generate Invoice</DialogTitle></DialogHeader>

        {!bookingId ? (
          // Single card: free-text search plus three optional narrowing
          // filters, all applied together over one result list — no tabs,
          // no separate "modes" to switch between.
          <div className="rounded-xl border border-border p-3.5 space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} autoFocus
                placeholder="Search by booking no, applicant, mobile, or project..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={hCompanyId} onChange={(e) => { setHCompanyId(e.target.value); setHProjectId(""); setHBlockId(""); }}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background">
                <option value="">Company: Any</option>
                {hCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={hProjectId} onChange={(e) => { setHProjectId(e.target.value); setHBlockId(""); }}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background">
                <option value="">Project: Any</option>
                {hProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={hBlockId} onChange={(e) => setHBlockId(e.target.value)}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background">
                <option value="">Block: Any</option>
                {hBlocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            {bookingsLoading ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Loading bookings…</p>
            ) : (
              <div className="max-h-72 overflow-y-auto thin-scroll rounded-lg border border-border divide-y divide-border">
                {filteredBookings.map((b: any) => (
                  <button key={b.Id} onClick={() => setBookingId(b.Id)}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/60 flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-primary">{b.BookingNo}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${
                          b.Status === "Approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                            : b.Status === "Rejected" || b.Status === "Cancelled" ? "text-red-700 bg-red-50 border-red-200"
                            : "text-amber-700 bg-amber-50 border-amber-200"
                        }`}>{b.Status}</span>
                      </div>
                      <div className="text-sm font-medium truncate">{b.ApplicantName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.ProjectName || "—"} · Unit {b.UnitNo || "—"}{b.Mobile ? ` · ${b.Mobile}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold">{fmtMoney(b.GrandTotal ?? b.TotalValue)}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtDate(b.BookingDate)}</div>
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
                {!filteredBookings.length && (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">No bookings match this search / filter combination.</div>
                )}
              </div>
            )}
          </div>
        ) : !booking ? (
          <p className="text-xs text-muted-foreground py-4">Loading booking…</p>
        ) : (
          <div className="space-y-3">
            {/* Auto-backfilled the moment a booking resolves — Company/
                Project/Block/Unit/Customer, all read straight off the real
                booking record, never re-typed. */}
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-primary">{booking.BookingNo}</span>
                {!initialBookingId && (
                  <button onClick={() => setBookingId(null)} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Customer</span><div className="font-medium truncate">{booking.ApplicantName}</div></div>
                <div><span className="text-muted-foreground">Company</span><div className="font-medium truncate">{booking.CompanyName || "—"}</div></div>
                <div><span className="text-muted-foreground">Project</span><div className="font-medium truncate">{booking.ProjectName || "—"}</div></div>
                <div><span className="text-muted-foreground">Block / Unit</span><div className="font-medium truncate">{[booking.BlockName, booking.UnitNo].filter(Boolean).join(" / ") || booking.UnitNo || "—"}</div></div>
              </div>
            </div>

            {/* Payment Plan, right here — the whole point is seeing real
                status before picking what to invoice, not guessing from a
                bare dropdown. Only Paid + Demanded + not-yet-invoiced rows
                are clickable; everything else shows why it isn't, in place. */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/30 border-b border-border text-xs font-semibold flex items-center justify-between">
                <span>Payment Plan</span>
                <span className="text-muted-foreground font-normal">Click an eligible milestone to invoice it</span>
              </div>
              <div className="max-h-40 overflow-y-auto thin-scroll divide-y divide-border">
                {milestones.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3">No milestone schedule on this booking.</p>
                ) : milestones.map((m: any) => {
                  const reason = milestoneIneligibleReason(m);
                  const selected = form.InvoiceType === "Milestone" && form.MilestoneId === String(m.Id);
                  return (
                    <button key={m.Id} disabled={!!reason}
                      onClick={() => setForm((f) => ({ ...f, InvoiceType: "Milestone", MilestoneId: String(m.Id), OnAccountPaymentId: "", Amount: "" }))}
                      className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 text-xs ${
                        reason ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                      } ${selected ? "bg-primary/10" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{m.MilestoneNo}. {m.MilestoneName}</span>
                          {milestoneStatusPill(m)}
                          {selected && <span className="text-primary font-medium">✓ Selected</span>}
                        </div>
                        {reason && <div className="text-[10px] text-muted-foreground">{reason}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">{fmtMoney(m.AmountDue)}</div>
                        <div className="text-[10px] text-muted-foreground">Paid {fmtMoney(m.AmountPaid)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Other invoice types — Milestone stays selected via the table
                above; these are the alternatives when there's nothing (or
                nothing more) to invoice from the payment plan itself. */}
            <div className="flex flex-wrap gap-1.5">
              {eligibleOnAccount.length > 0 && (
                <button onClick={() => setForm((f) => ({ ...f, InvoiceType: "OnAccount", MilestoneId: "" }))}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${form.InvoiceType === "OnAccount" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  On-Account Payment
                </button>
              )}
              <button onClick={() => setForm((f) => ({ ...f, InvoiceType: "Maintenance", MilestoneId: "" }))}
                className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${form.InvoiceType === "Maintenance" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                Maintenance
              </button>
              <button onClick={() => setForm((f) => ({ ...f, InvoiceType: "Other", MilestoneId: "" }))}
                className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${form.InvoiceType === "Other" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                Other
              </button>
            </div>

            {form.InvoiceType === "OnAccount" && (
              <select value={form.OnAccountPaymentId} onChange={(e) => setForm((f) => ({ ...f, OnAccountPaymentId: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                <option value="">— Select an on-account payment —</option>
                {eligibleOnAccount.map((p: any) => (
                  <option key={p.Id} value={String(p.Id)}>{p.ReceiptNo} — {fmtMoney(p.Amount)}</option>
                ))}
              </select>
            )}
            {(form.InvoiceType === "Maintenance" || form.InvoiceType === "Other") && (
              <div className="grid grid-cols-2 gap-2">
                <input type="number" placeholder="Amount" value={form.Amount}
                  onChange={(e) => setForm((f) => ({ ...f, Amount: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                <input type="date" value={form.InvoiceDate}
                  onChange={(e) => setForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </div>
            )}
            <input placeholder="Description (optional)" value={form.Description}
              onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />

            {/* Customisable AND prefixed numbering, side by side as one
                choice: Auto keeps the standard INV-YYYY-NNNNN series (the
                normal case); Prefix lets staff supply just a prefix (a
                project's own series) while the number after it still
                auto-increments through the same safe counter; Custom is a
                fully manual, exact number for a one-off case (a promised
                reference, a migrated legacy number). */}
            <div className="rounded-lg border border-border p-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                {([
                  { key: "auto", label: "Auto" },
                  { key: "prefix", label: "Custom Prefix" },
                  { key: "custom", label: "Exact Number" },
                ] as const).map((o) => (
                  <button key={o.key} onClick={() => setForm((f) => ({ ...f, NumberMode: o.key }))}
                    className={`text-xs px-2.5 py-1 rounded-md border font-medium ${form.NumberMode === o.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              {form.NumberMode === "auto" && (
                <p className="text-[11px] text-muted-foreground">Standard series — the next INV-{new Date().getFullYear()}-NNNNN number.</p>
              )}
              {form.NumberMode === "prefix" && (
                <div>
                  <input placeholder="e.g. TSTRSD" value={form.InvoicePrefix}
                    onChange={(e) => setForm((f) => ({ ...f, InvoicePrefix: e.target.value.toUpperCase() }))}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background font-mono uppercase" maxLength={10} />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Generates as {form.InvoicePrefix.trim() ? form.InvoicePrefix.trim().toUpperCase() : "PREFIX"}-{new Date().getFullYear()}-NNNNN — its own auto-incrementing series.
                  </p>
                </div>
              )}
              {form.NumberMode === "custom" && (
                <div>
                  <input placeholder="Exact invoice number" value={form.CustomInvoiceNo}
                    onChange={(e) => setForm((f) => ({ ...f, CustomInvoiceNo: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background font-mono" maxLength={30} />
                  <p className="text-[11px] text-muted-foreground mt-1">Used exactly as typed — must be unique across every invoice.</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          {bookingId && booking && (
            <button onClick={handleGenerate}
              disabled={saving || (form.InvoiceType === "Milestone" && !form.MilestoneId) || (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Generating…" : "Generate"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmInvoices: React.FC = () => {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Dedicated-usage-area wiring: the Booking page's own Payment & Invoice
  // tab links here with ?bookingId=X for anything beyond the Booking Amount
  // invoice (which stays exclusive to that page) — arriving with that param
  // jumps straight to step two, already scoped to that booking, instead of
  // making staff search for the booking they just came from.
  useEffect(() => {
    const bid = searchParams.get("bookingId");
    if (bid) {
      setGenBookingId(parseInt(bid, 10));
      const next = new URLSearchParams(searchParams);
      next.delete("bookingId");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["crm-invoices", type, search],
    queryFn: () => fetchInvoices(type, search),
    placeholderData: (prev) => prev,
  });

  // Booking-wise separated — every invoice grouped under the booking it
  // belongs to, most recently active booking first, instead of one flat
  // cross-booking table. This is the whole point of a dedicated Invoices
  // page: see a booking's full invoice history together, and generate the
  // next one right there.
  const groups = useMemo(() => {
    const byBooking = new Map<number, { booking: InvoiceRow; invoices: InvoiceRow[] }>();
    for (const r of rows) {
      if (!byBooking.has(r.BookingId)) byBooking.set(r.BookingId, { booking: r, invoices: [] });
      byBooking.get(r.BookingId)!.invoices.push(r);
    }
    return Array.from(byBooking.values()).sort((a, b) =>
      new Date(b.invoices[0]?.CreatedAt || 0).getTime() - new Date(a.invoices[0]?.CreatedAt || 0).getTime());
  }, [rows]);

  function toggleCollapsed(bookingId: number) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(bookingId)) next.delete(bookingId); else next.add(bookingId);
      return next;
    });
  }

  function handleGenerated() {
    setGenBookingId(undefined);
    qc.invalidateQueries({ queryKey: ["crm-invoices"] });
  }

  return (
    <SalesAutoShell
      title="CRM — Invoices"
      subtitle="Booking-wise invoice history and generation — Milestone (beyond the Booking Amount), Maintenance, Other, and On-Account. The Booking Amount invoice itself is generated from the Booking's own Payment & Invoice tab."
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
            placeholder="Search invoice no, booking, applicant..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setSearch(searchInput.trim())} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted">Search</button>
        {(type || search) && (
          <button onClick={() => { setType(""); setSearch(""); setSearchInput(""); }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Clear filters</button>
        )}
        <button onClick={() => setGenBookingId(null)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
          <Plus className="w-4 h-4" /> Generate Invoice
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center">
          <p className="text-sm text-muted-foreground">No invoices generated yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ booking, invoices }) => {
            const isCollapsed = collapsed.has(booking.BookingId);
            const total = invoices.reduce((sum, i) => sum + Number(i.Amount || 0), 0);
            return (
              <div key={booking.BookingId} className="rounded-xl border border-border bg-card overflow-hidden">
                <button onClick={() => toggleCollapsed(booking.BookingId)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                    <Building2 size={14} className="text-primary shrink-0" />
                    <span className="font-mono text-sm font-semibold">{booking.BookingNo}</span>
                    <span className="text-sm text-muted-foreground truncate">{booking.ApplicantName}</span>
                    {booking.ProjectName && <span className="text-xs text-muted-foreground truncate hidden sm:inline">· {booking.ProjectName} {booking.UnitNo}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <span className="text-muted-foreground">{invoices.length} invoice{invoices.length > 1 ? "s" : ""} · {fmtMoney(total)}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); setGenBookingId(booking.BookingId); }}
                      className="flex items-center gap-1 px-2 py-1 border border-border rounded-md font-medium hover:bg-muted">
                      <Plus size={12} /> Add
                    </span>
                    <a href={`/crm/bookings?view=${booking.BookingId}`} onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-2 py-1 border border-border rounded-md font-medium hover:bg-muted">
                      <ExternalLink size={12} /> Booking
                    </a>
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="border-t border-border overflow-x-auto thin-scroll">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Invoice No.</th>
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Type</th>
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Amount</th>
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Date</th>
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Generated By</th>
                          <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">PDF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv) => (
                          <tr key={inv.Id} className="border-b border-border last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-1.5 font-mono text-xs font-semibold text-primary">{inv.InvoiceNo}</td>
                            <td className="px-3 py-1.5"><span className="text-xs px-2 py-0.5 rounded-md bg-muted font-medium">{inv.InvoiceType}</span></td>
                            <td className="px-3 py-1.5 font-medium">{fmtMoney(inv.Amount)}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(inv.InvoiceDate)}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{inv.CreatedByName || "—"}</td>
                            <td className="px-3 py-1.5">
                              <button onClick={() => setPreview(inv)}
                                className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
                                <FileText className="w-3 h-3" /> View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {preview && <InvoicePreviewDialog invoice={preview} onClose={() => setPreview(null)} />}
      {genBookingId !== undefined && (
        <GenerateInvoiceDialog initialBookingId={genBookingId} onClose={() => setGenBookingId(undefined)} onGenerated={handleGenerated} />
      )}
    </SalesAutoShell>
  );
};

export default CrmInvoices;
