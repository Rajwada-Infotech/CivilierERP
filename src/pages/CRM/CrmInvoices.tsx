import React, { useEffect, useMemo, useState } from "react";
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

// Two-step: pick a booking (unless one was already handed in from a group
// header's own "+ Add Invoice"), then pick what to invoice for it. Mirrors
// the exact same eligibility rules the Booking page's own (now Booking-
// Amount-only) dialog used to enforce for everything else: a milestone must
// be Paid with its Demand raised, an on-account deposit must not already be
// invoiced — never a freehand amount typed against nothing real. Milestone
// #1 (the Booking Amount) is deliberately excluded here — that one only
// ever gets generated from the Booking's own Payment & Invoice tab.
function GenerateInvoiceDialog({ initialBookingId, onClose, onGenerated }: { initialBookingId: number | null; onClose: () => void; onGenerated: () => void }) {
  const [bookingId, setBookingId] = useState<number | null>(initialBookingId);
  const [bookingSearch, setBookingSearch] = useState("");
  const [form, setForm] = useState({ InvoiceType: "Milestone", MilestoneId: "", OnAccountPaymentId: "", Amount: "", InvoiceDate: new Date().toLocaleDateString("en-CA"), Description: "" });
  const [saving, setSaving] = useState(false);

  const { data: bookings = [] } = useQuery({
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

  const filteredBookings = useMemo(() => {
    if (!bookingSearch.trim()) return bookings.slice(0, 30);
    const q = bookingSearch.trim().toLowerCase();
    return bookings.filter((b: any) =>
      String(b.BookingNo || "").toLowerCase().includes(q) || String(b.ApplicantName || "").toLowerCase().includes(q)).slice(0, 30);
  }, [bookings, bookingSearch]);

  async function handleGenerate() {
    if (form.InvoiceType === "Milestone" && !form.MilestoneId) { toast.error("Select a milestone"); return; }
    if (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId) { toast.error("Select an on-account payment"); return; }
    if (!["Milestone", "OnAccount"].includes(form.InvoiceType) && !form.Amount) { toast.error("Amount is required"); return; }
    setSaving(true);
    try {
      const body: any = { InvoiceType: form.InvoiceType, Description: form.Description };
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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">Generate Invoice</DialogTitle></DialogHeader>

        {!bookingId ? (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">Booking</label>
            <input value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)}
              placeholder="Search booking no or applicant..."
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {filteredBookings.map((b: any) => (
                <button key={b.Id} onClick={() => setBookingId(b.Id)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex justify-between items-center">
                  <span className="font-mono text-xs">{b.BookingNo}</span>
                  <span className="text-muted-foreground text-xs">{b.ApplicantName}</span>
                </button>
              ))}
              {!filteredBookings.length && <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>}
            </div>
          </div>
        ) : !booking ? (
          <p className="text-xs text-muted-foreground py-4">Loading booking…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm font-medium">{booking.BookingNo} — {booking.ApplicantName}</span>
              {!initialBookingId && (
                <button onClick={() => setBookingId(null)} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
              )}
            </div>

            <select value={form.InvoiceType}
              onChange={(e) => setForm((f) => ({ ...f, InvoiceType: e.target.value, MilestoneId: "", OnAccountPaymentId: "", Amount: "" }))}
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
              {eligibleMilestones.length > 0 && <option value="Milestone">Milestone Payment</option>}
              {eligibleOnAccount.length > 0 && <option value="OnAccount">On-Account Payment</option>}
              <option value="Maintenance">Maintenance</option>
              <option value="Other">Other</option>
            </select>

            {form.InvoiceType === "Milestone" ? (
              <>
                <select value={form.MilestoneId} onChange={(e) => setForm((f) => ({ ...f, MilestoneId: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">— Select a paid milestone —</option>
                  {eligibleMilestones.map((m: any) => (
                    <option key={m.Id} value={String(m.Id)}>{m.MilestoneName} — {fmtMoney(m.AmountPaid)}</option>
                  ))}
                </select>
                {eligibleMilestones.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No paid, demanded milestone is waiting on an invoice for this booking. Raise a demand from the Demands page first.</p>
                )}
              </>
            ) : form.InvoiceType === "OnAccount" ? (
              <select value={form.OnAccountPaymentId} onChange={(e) => setForm((f) => ({ ...f, OnAccountPaymentId: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                <option value="">— Select an on-account payment —</option>
                {eligibleOnAccount.map((p: any) => (
                  <option key={p.Id} value={String(p.Id)}>{p.ReceiptNo} — {fmtMoney(p.Amount)}</option>
                ))}
              </select>
            ) : (
              <>
                <input type="number" placeholder="Amount" value={form.Amount}
                  onChange={(e) => setForm((f) => ({ ...f, Amount: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                <input type="date" value={form.InvoiceDate}
                  onChange={(e) => setForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </>
            )}
            <input placeholder="Description (optional)" value={form.Description}
              onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
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
  const [type, setType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

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
