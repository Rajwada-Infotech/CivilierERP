import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  FileText, Download, Search, ExternalLink, Plus, ChevronDown, ChevronRight, Building2, Info,
  CheckCircle2, AlertCircle, Ban, ChevronLeft, LayoutGrid, Rows3, Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

// Same approver set the backend's INVOICE_VOID_ROLES enforces
// (crmBookings.js PUT /:id/invoices/:invoiceId/void) — this only controls
// button visibility, the server re-checks independently.
const INVOICE_VOID_ROLES = ["admin", "super_admin", "dba", "accounts_head"];

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
  VoidReason: string | null;
  CreatedAt: string;
  BookingId: number;
  MilestoneId?: number | null;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedByName: string | null;
}

interface BookingGroup {
  BookingId: number;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  MilestoneTotal: number;
  MilestoneInvoiced: number;
  Invoices: InvoiceRow[];
}

const TYPES = ["Milestone", "Maintenance", "Other", "OnAccount", "Agreement", "Possession"];
const PAGE_SIZE = 20;

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  // Bare date strings (YYYY-MM-DD) parsed as UTC shift by one day in IST.
  // Force local midnight by appending T00:00:00 before parsing.
  const iso = String(v).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN");
}

// Shared filter shape for the main list — both the grouped and flat views
// read off the same committed filter set + page, so switching between them
// never shows disagreeing data.
interface ListFilters {
  type: string; search: string; projectId: string; blockId: string;
  invoicedStatus: string; dateFrom: string; dateTo: string;
}

async function fetchInvoiceList(
  view: "grouped" | "flat",
  filters: ListFilters,
  page: number,
  sortKey = "CreatedAt",
  sortDir: "asc" | "desc" = "desc",
): Promise<any> {
  const q = new URLSearchParams();
  q.set("view", view);
  q.set("page", String(page));
  q.set("pageSize", String(PAGE_SIZE));
  if (filters.type) q.set("type", filters.type);
  if (filters.search) q.set("search", filters.search);
  if (filters.projectId) q.set("projectId", filters.projectId);
  if (filters.blockId) q.set("blockId", filters.blockId);
  if (view === "grouped" && filters.invoicedStatus) q.set("invoicedStatus", filters.invoicedStatus);
  if (filters.dateFrom) q.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) q.set("dateTo", filters.dateTo);
  if (view === "flat") { q.set("sortKey", sortKey); q.set("sortDir", sortDir); }
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

// Every query that a booking's invoice/milestone state feeds — invalidated
// together on generate/void so the list, the modal, and a bulk-generate
// result can never disagree with each other or go stale independently of
// one another (previously only "crm-invoices" was invalidated, leaving the
// modal's own three queries stale if it stayed open).
function invalidateInvoiceRelatedQueries(qc: ReturnType<typeof useQueryClient>, bookingId?: number) {
  qc.invalidateQueries({ queryKey: ["crm-invoices"] });
  if (bookingId != null) {
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-existing", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-booking-detail", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-on-account", bookingId] });
  } else {
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-existing"] });
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-booking-detail"] });
    qc.invalidateQueries({ queryKey: ["crm-invoice-gen-on-account"] });
  }
}

type MilestoneTone = "ready" | "invoiced" | "partial" | "unpaid" | "demand" | "booking";
interface MilestoneInsight { tone: MilestoneTone; message: string; icon: typeof CheckCircle2; }

// One place that decides "can this milestone be invoiced, and why/why not" —
// both the eligibility filter (which type the dialog defaults to) and the
// row's own message/icon read off this same function, so they can never
// disagree the way two separately-maintained checks eventually would.
// This is BILLING eligibility (has a Demand been raised, is it already
// invoiced) — a separate axis from PAYMENT settlement (milestoneStatusPill,
// below), which is why both are now explicitly labeled where they render
// together, instead of reading as a contradiction ("Paid" + "Ready to
// invoice" on the same row used to look like a bug — it's two different
// questions with two different, both-correct answers).
function getMilestoneInsight(m: any, existingInvoices: any[]): MilestoneInsight {
  // A Void invoice frees its milestone slot (see migration 325) — it must
  // not count as "already invoiced" here, or a corrected invoice could never
  // be raised for a milestone whose first attempt was voided.
  const existingInv = existingInvoices.find((inv: any) => inv.MilestoneId === m.Id && inv.Status !== "Void");
  if (existingInv) {
    return { tone: "invoiced", message: `Already invoiced — ${existingInv.InvoiceNo}`, icon: FileText as any };
  }
  // Booking Amount (Milestone #1) not yet invoiced — visible in the counter
  // and row list (so the progress bar is accurate), but generated exclusively
  // from the Booking page's own Payment & Invoice tab to avoid two places
  // doing the same thing. Show an informational pointer, not a generate button.
  if (Number(m.MilestoneNo) === 1) {
    return { tone: "booking", message: "Generated from the Booking page — Payment & Invoice tab", icon: ExternalLink as any };
  }
  // Invoice is generated from the demand (billing doc for AmountDue), BEFORE
  // On Account Adjustment settles the milestone. Only gate: demand must exist.
  if (m.DemandStatus === CrmStatus.PENDING) {
    return { tone: "demand", message: "Raise a demand (Demands page) to unlock invoicing", icon: AlertCircle };
  }
  return { tone: "ready", message: "Ready to invoice", icon: CheckCircle2 };
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
        {invoice.Status === "Void" && (
          <p className="text-[11px] text-red-600 dark:text-red-400">Voided{invoice.VoidReason ? ` — ${invoice.VoidReason}` : ""}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoidInvoiceDialog({ invoice, onClose, onVoided }: { invoice: InvoiceRow; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleVoid() {
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("A reason is required to void an invoice"); return; }
    setBusy(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${invoice.BookingId}/invoices/${invoice.Id}/void`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Void failed" }));
        toast.error(err.error || "Void failed");
        return;
      }
      toast.success(`${invoice.InvoiceNo} voided`);
      onVoided();
    } catch {
      toast.error("Network error — could not void invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban size={16} className="text-red-500" /> Void {invoice.InvoiceNo}</DialogTitle>
          <DialogDescription>
            {invoice.InvoiceType} · {fmtMoney(invoice.Amount)} · {invoice.BookingNo}. This keeps the invoice on record for audit but frees it up so a corrected one can be generated in its place.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason <span className="text-red-500">*</span></label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this invoice being voided?"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            autoFocus
          />
        </div>
        <DialogFooter>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">
            Cancel
          </button>
          <button onClick={handleVoid} disabled={busy || !reason.trim()}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            {busy ? "Voiding…" : "Void Invoice"}
          </button>
        </DialogFooter>
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
// increments, or one fully custom number. Also supports selecting several
// "ready" milestones at once and generating all their invoices in a single
// bulk action.
function GenerateInvoiceDialog({ initialBookingId, onClose, onGenerated }: { initialBookingId: number | null; onClose: () => void; onGenerated: (bookingId: number) => void }) {
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
  // True only when InvoiceType was switched by the eligibility effect below,
  // never by the user clicking something themselves — drives the inline
  // "why is this selected" banner instead of silently landing on Maintenance.
  const [autoSelected, setAutoSelected] = useState(false);
  // Maintenance/Other take a free-typed Amount with zero link to any
  // milestone or receipt — that escape hatch is exactly what let a ₹10,000
  // "Maintenance" invoice get raised on a booking that actually had a real,
  // specific ₹5,000 shortfall sitting on an unpaid milestone. This
  // acknowledgment gates Generate shut for that combination until staff
  // explicitly confirms they know it won't touch that balance — resets
  // whenever they switch type/booking so a stale ack can't carry over.
  const [ackUnlinked, setAckUnlinked] = useState(false);
  // Bulk selection — ready-milestone IDs picked for "generate all at once".
  // Independent of the single-select InvoiceType/MilestoneId flow above;
  // choosing bulk rows doesn't touch the single-generate form at all.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
  const { data: existingInvoices = [], refetch: refetchExisting } = useQuery({
    queryKey: ["crm-invoice-gen-existing", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`);
      return r.ok ? r.json() : [];
    },
    enabled: !!bookingId,
  });

  const booking = bookingDetail?.booking;
  const milestones: any[] = bookingDetail?.milestones || [];
  const eligibleMilestones = milestones.filter((m) => getMilestoneInsight(m, existingInvoices).tone === "ready");
  const eligibleOnAccount = (onAccountData?.payments || []).filter(
    (p: any) => !p.InvoiceId && !existingInvoices.some((inv: any) => inv.OnAccountPaymentId === p.Id && inv.Status !== "Void")
  );
  // Real money still owed on this booking's payment plan — a Maintenance/
  // Other invoice never touches this, so raising one while this is non-empty
  // is the exact shape of mistake this warning exists to catch.
  const outstandingMilestones = milestones.filter(
    (m) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && (Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)) > 0
  );
  const outstandingTotal = outstandingMilestones.reduce((s, m) => s + (Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)), 0);
  const showUnlinkedWarning = (form.InvoiceType === "Maintenance" || form.InvoiceType === "Other") && outstandingMilestones.length > 0;

  // Once this booking's eligibility is known, land on whichever type
  // actually has something to invoice instead of defaulting to "Milestone"
  // and showing an empty-state message for a booking that has none.
  useEffect(() => {
    if (!booking) return;
    if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length > 0) {
      setForm((f) => ({ ...f, InvoiceType: "OnAccount" }));
      setAutoSelected(true);
    } else if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length === 0) {
      setForm((f) => ({ ...f, InvoiceType: "Maintenance" }));
      setAutoSelected(true);
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
      onGenerated(bookingId as number);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  }

  function toggleBulk(id: number) {
    setBulkSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkGenerate() {
    if (!bulkSelected.size || !bookingId) return;
    setBulkBusy(true);
    try {
      const items = Array.from(bulkSelected).map((milestoneId) => ({ bookingId, milestoneId }));
      const res = await fetchWithAuth(`${BKG_API}/invoices/bulk-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk generation failed");
      const succeeded = data.succeeded?.length || 0;
      const skipped = data.skipped?.length || 0;
      if (succeeded) toast.success(`${succeeded} invoice${succeeded !== 1 ? "s" : ""} generated`);
      if (skipped) toast.error(`${skipped} skipped — ${data.skipped.map((s: any) => s.reason).join("; ")}`);
      setBulkSelected(new Set());
      refetchExisting();
      onGenerated(bookingId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBulkBusy(false);
    }
  }

  // Milestone status pill styling, shared by the payment-plan table below.
  // Labeled "Payment" here (as opposed to the Billing label on the insight
  // message below it) so the two independent axes read as two answers, not
  // a contradiction — a milestone can be Payment: Paid (settled via On
  // Account Adjustment) while still Billing: Ready to invoice never having
  // happened, or vice versa, and both are simultaneously true statements.
  function milestoneStatusPill(m: any) {
    if (m.Status === CrmStatus.PAID) return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-emerald-700 bg-emerald-50 border-emerald-200">Payment: Paid</span>;
    if (m.Status === "Waived") return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40 border-border">Payment: Waived</span>;
    if (Number(m.AmountPaid) > 0) return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-amber-700 bg-amber-50 border-amber-200">Payment: Partial</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40 border-border">Payment: Pending</span>;
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
                          b.Status === CrmStatus.APPROVED ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                            : b.Status === CrmStatus.REJECTED || b.Status === CrmStatus.CANCELLED ? "text-red-700 bg-red-50 border-red-200"
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
                  <button onClick={() => { setBookingId(null); setAckUnlinked(false); setBulkSelected(new Set()); }} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
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
                bare dropdown. Only Demanded + not-yet-invoiced rows are
                clickable (see getMilestoneInsight — gated on DemandStatus,
                not on the milestone being Paid/Settled, since an invoice is
                generated from a Demand, before On Account Adjustment ever
                settles anything); everything else shows why it isn't, in
                place. Each eligible row also carries a checkbox for the bulk
                "select several, generate all at once" action below. */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/30 border-b border-border text-xs font-semibold flex items-center justify-between">
                <span>Invoice Type</span>
                <span className="text-muted-foreground font-normal">Choose one row below to generate single, tick boxes to bulk-generate</span>
              </div>
              <div className="max-h-56 overflow-y-auto thin-scroll divide-y divide-border">
                {milestones.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3">No milestone schedule on this booking.</p>
                ) : milestones.map((m: any) => {
                  const insight = getMilestoneInsight(m, existingInvoices);
                  const eligible = insight.tone === "ready";
                  const isBookingAmountPointer = insight.tone === "booking";
                  const selected = form.InvoiceType === "Milestone" && form.MilestoneId === String(m.Id);
                  const bulkChecked = bulkSelected.has(m.Id);
                  const pct = Math.min(100, Math.round((Number(m.AmountPaid || 0) / Math.max(Number(m.AmountDue || 0), 1)) * 100));
                  const Icon = insight.icon;
                  const toneText =
                    insight.tone === "ready" ? "text-emerald-700 dark:text-emerald-400"
                    : insight.tone === "invoiced" ? "text-primary"
                    : insight.tone === "partial" ? "text-amber-700 dark:text-amber-400"
                    : insight.tone === "demand" ? "text-sky-700 dark:text-sky-400"
                    : insight.tone === "booking" ? "text-violet-600 dark:text-violet-400"
                    : "text-muted-foreground";
                  return (
                    <div key={m.Id}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2.5 text-xs ${
                        eligible ? "hover:bg-muted/50" : "opacity-75"
                      } ${selected ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent"}`}>
                      {eligible ? (
                        <input type="checkbox" checked={bulkChecked} onChange={() => toggleBulk(m.Id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 shrink-0 accent-primary" />
                      ) : (
                        <span className="w-[13px] shrink-0" />
                      )}
                      <button disabled={!eligible}
                        onClick={() => { setForm((f) => ({ ...f, InvoiceType: "Milestone", MilestoneId: String(m.Id), OnAccountPaymentId: "", Amount: "" })); setAutoSelected(false); setAckUnlinked(false); }}
                        className={`min-w-0 flex-1 text-left ${eligible ? "cursor-pointer" : "cursor-not-allowed"}`}>
                        <Icon size={13} className={`inline-block mr-1.5 -mt-0.5 ${toneText}`} />
                        <span className="font-medium">{m.MilestoneNo}. {m.MilestoneName}</span>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          {milestoneStatusPill(m)}
                          {selected && <span className="text-primary font-medium">✓ Selected</span>}
                        </div>
                        <div className={`mt-0.5 ${toneText}`}>
                          {isBookingAmountPointer ? insight.message : `Billing: ${insight.message}`}
                        </div>
                        {(insight.tone === "partial" || insight.tone === "unpaid") && (
                          <div className="h-1 rounded-full bg-muted overflow-hidden mt-1.5 max-w-[160px]">
                            <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </button>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">{fmtMoney(m.AmountDue)}</div>
                        <div className="text-[10px] text-muted-foreground">Paid {fmtMoney(m.AmountPaid)}</div>
                        {isBookingAmountPointer && (
                          <a href={`/crm/bookings?view=${bookingId}`}
                            className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline mt-0.5 block"
                            onClick={(e) => e.stopPropagation()}>
                            Open Booking ↗
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border bg-muted/10 px-3 py-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-0.5">or</span>
                {eligibleOnAccount.length > 0 && (
                  <button onClick={() => { setForm((f) => ({ ...f, InvoiceType: "OnAccount", MilestoneId: "" })); setAutoSelected(false); setAckUnlinked(false); }}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${form.InvoiceType === "OnAccount" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                    {form.InvoiceType === "OnAccount" && <span>✓</span>} On-Account Payment
                  </button>
                )}
                <button onClick={() => { setForm((f) => ({ ...f, InvoiceType: "Maintenance", MilestoneId: "" })); setAutoSelected(false); setAckUnlinked(false); }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${form.InvoiceType === "Maintenance" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {form.InvoiceType === "Maintenance" && <span>✓</span>} Maintenance
                </button>
                <button onClick={() => { setForm((f) => ({ ...f, InvoiceType: "Other", MilestoneId: "" })); setAutoSelected(false); setAckUnlinked(false); }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${form.InvoiceType === "Other" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {form.InvoiceType === "Other" && <span>✓</span>} Other
                </button>
              </div>

              {autoSelected && (
                <div className="border-t border-border bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  No milestones are currently eligible for this booking, so <strong className="mx-0.5">{form.InvoiceType}</strong> was selected automatically — pick a different type above if that's not what you want.
                </div>
              )}
            </div>

            {/* Sticky bulk-action bar — appears only once at least one
                eligible row above is checked. Independent of the single
                Invoice Type selection; picking bulk rows doesn't change
                form.InvoiceType at all. */}
            {bulkSelected.size > 0 && (
              <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium">{bulkSelected.size} milestone{bulkSelected.size !== 1 ? "s" : ""} selected</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setBulkSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                  <button onClick={handleBulkGenerate} disabled={bulkBusy}
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50">
                    {bulkBusy ? "Generating…" : `Generate ${bulkSelected.size} Invoice${bulkSelected.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}

            {form.InvoiceType === "OnAccount" && (
              <div className="space-y-1.5">
                {/* On Account balance was fetched but never actually shown —
                    staff picked a specific past deposit from the dropdown
                    with no visibility into the customer's total available
                    balance for context. */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                  <Wallet size={13} className="text-primary shrink-0" />
                  On Account balance available: <span className="font-semibold text-foreground">{fmtMoney(onAccountData?.availableBalance ?? 0)}</span>
                </div>
                <select value={form.OnAccountPaymentId} onChange={(e) => setForm((f) => ({ ...f, OnAccountPaymentId: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">— Select an on-account payment —</option>
                  {eligibleOnAccount.map((p: any) => (
                    <option key={p.Id} value={String(p.Id)}>{p.ReceiptNo} — {fmtMoney(p.Amount)}</option>
                  ))}
                </select>
              </div>
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
            {/* This booking still has a real amount outstanding on its
                payment plan — a Maintenance/Other invoice is free-typed and
                has zero link to any milestone or receipt, so raising one
                here won't record anything against that balance. Requires an
                explicit ack (not just a dismissible notice) before Generate
                unlocks, since a silent warning is exactly what got missed
                the last time this produced an unlinked invoice. */}
            {showUnlinkedWarning && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    This booking still has <strong>{fmtMoney(outstandingTotal)}</strong> outstanding on{" "}
                    {outstandingMilestones.length === 1
                      ? <>"{outstandingMilestones[0].MilestoneName}"</>
                      : `${outstandingMilestones.length} milestones`}.
                    A {form.InvoiceType} invoice is unrelated to the payment plan and won't record a payment against it —
                    if you're trying to settle that balance, use the payment/receipt flow instead, then generate a Milestone invoice once a Demand has been raised for it.
                  </span>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-400 cursor-pointer">
                  <input type="checkbox" checked={ackUnlinked} onChange={(e) => setAckUnlinked(e.target.checked)} className="accent-amber-600" />
                  This invoice is unrelated to that outstanding balance — go ahead
                </label>
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
              disabled={saving || (form.InvoiceType === "Milestone" && !form.MilestoneId) || (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId) || (showUnlinkedWarning && !ackUnlinked)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Generating…" : "Generate"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Small "N of M invoiced" progress bar for a booking's header row in the
// grouped list — visual convention (gradient bar, height, rounded corners)
// matches CrmOnAccount.tsx's own per-row utilization bar, for consistency
// across the two money-tracking pages rather than inventing new styling.
function MilestoneProgressBar({ total, invoiced }: { total: number; invoiced: number }) {
  if (!total) return <span className="text-[11px] text-muted-foreground">No milestone schedule</span>;
  const pct = Math.min(100, Math.round((invoiced / total) * 100));
  return (
    <div className="flex items-center gap-1.5 min-w-[110px]">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden shrink-0">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">{invoiced} of {total} invoiced</span>
    </div>
  );
}

function PaginationBar({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-1 py-2 text-xs text-muted-foreground">
      <span>Page {page} of {totalPages} · {total} total</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}
          className="flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronLeft size={12} /> Prev
        </button>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
          className="flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

const INVOICED_STATUS_OPTIONS = [
  { value: "", label: "Any invoicing status" },
  { value: "full", label: "Fully invoiced" },
  { value: "partial", label: "Partially invoiced" },
  { value: "none", label: "Not invoiced yet" },
];

const CrmInvoices: React.FC = () => {
  const rights = usePageRights("crm-invoices");
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canVoid = !!currentUser?.role && INVOICE_VOID_ROLES.includes(currentUser.role);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<"grouped" | "flat">("grouped");
  const [type, setType] = useState("");
  const [invoicedStatus, setInvoicedStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [lastDeepLinkedInvoiceId, setLastDeepLinkedInvoiceId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [flatSort, setFlatSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "CreatedAt", dir: "desc" });

  // Reused for the filter bar's Project/Block dropdowns — same endpoint and
  // query key the Generate Invoice modal already uses, so React Query
  // shares one cached fetch between them instead of hitting the bookings
  // list twice.
  const { data: bookingsForFilters = [] } = useQuery({
    queryKey: ["crm-bookings-for-invoice-picker"],
    queryFn: fetchBookingsForPicker,
    staleTime: 60_000,
  });
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bookingsForFilters) {
      if (b.ProjectId == null || seen.has(String(b.ProjectId))) continue;
      seen.set(String(b.ProjectId), b.ProjectName || `#${b.ProjectId}`);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [bookingsForFilters]);
  const blockOptions = useMemo(() => {
    const pool = projectId ? bookingsForFilters.filter((b: any) => String(b.ProjectId) === projectId) : bookingsForFilters;
    const seen = new Map<string, string>();
    for (const b of pool) {
      if (b.BlockId == null || seen.has(String(b.BlockId))) continue;
      seen.set(String(b.BlockId), b.BlockName || `#${b.BlockId}`);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [bookingsForFilters, projectId]);

  // The Booking page's own Payment & Invoice tab links here with ?bookingId=X
  // to pre-select that booking in the Generate dialog.
  useEffect(() => {
    const bid = searchParams.get("bookingId");
    if (bid && rights.canCreate) {
      setGenBookingId(parseInt(bid, 10));
      const next = new URLSearchParams(searchParams);
      next.delete("bookingId");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?invoiceId= persists in the URL while a preview is open so it can be
  // bookmarked/shared. Track the last ID we opened — not a boolean — so
  // navigating to a *different* ?invoiceId= (e.g. a copied link) always
  // opens the new one instead of being blocked by the stale flag.
  const openInvoice = (inv: InvoiceRow) => {
    setPreview(inv);
    setSearchParams((sp) => { sp.set("invoiceId", String(inv.Id)); return sp; }, { replace: true });
  };
  const closeInvoice = () => {
    setPreview(null);
    setSearchParams((sp) => { sp.delete("invoiceId"); return sp; }, { replace: true });
  };

  const filters: ListFilters = { type, search, projectId, blockId, invoicedStatus, dateFrom, dateTo };
  // flatSort is part of the query key so changing sort column/direction
  // triggers a fresh server fetch (server-side ORDER BY across all pages).
  const { data, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-invoices", view, filters, page, flatSort],
    queryFn: () => fetchInvoiceList(view, filters, page, flatSort.key, flatSort.dir),
    placeholderData: (prev) => prev,
  });
  const groups: BookingGroup[] = data?.view === "grouped" ? data.groups : [];
  const flatRows: InvoiceRow[] = data?.view === "flat" ? data.rows : [];
  const total = data?.total || 0;

  // Any filter change (other than paging itself) resets back to page 1 —
  // otherwise a narrower result set can leave the user stranded on a page
  // number that no longer exists.
  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  // Sort column toggle — resets to page 1 so you always see the globally
  // highest/lowest rows, not just the sorted current page.
  function toggleFlatSort(key: string) {
    setFlatSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
    setPage(1);
  }

  // Deep-link: open the preview for ?invoiceId= on load or when the URL
  // param changes to a different value (e.g. copied link opened in same tab).
  useEffect(() => {
    const invId = searchParams.get("invoiceId");
    if (!invId || invId === lastDeepLinkedInvoiceId) return;
    const pool = view === "grouped" ? groups.flatMap((g) => g.Invoices) : flatRows;
    if (!pool.length) return;
    const match = pool.find((r) => String(r.Id) === invId);
    if (match) {
      setLastDeepLinkedInvoiceId(invId);
      setPreview(match);
    }
  }, [searchParams, lastDeepLinkedInvoiceId, groups, flatRows, view]);

  function toggleCollapsed(bookingId: number) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(bookingId)) next.delete(bookingId); else next.add(bookingId);
      return next;
    });
  }

  function handleGenerated(bookingId: number) {
    setGenBookingId(undefined);
    invalidateInvoiceRelatedQueries(qc, bookingId);
  }

  const hasActiveFilters = !!(type || search || projectId || blockId || invoicedStatus || dateFrom || dateTo);
  function clearFilters() {
    setType(""); setSearch(""); setSearchInput(""); setProjectId(""); setBlockId("");
    setInvoicedStatus(""); setDateFrom(""); setDateTo(""); setPage(1);
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Invoices"]} />
      <CrmShell
        title="CRM — Invoices"
      subtitle="Booking-wise invoice history and generation — Milestone (including Booking Amount), Maintenance, Other, and On-Account."
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (setSearch(searchInput.trim()), setPage(1))}
            placeholder="Search invoice no, booking, applicant..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={type} onChange={(e) => resetToFirstPage(setType)(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={projectId} onChange={(e) => { resetToFirstPage(setProjectId)(e.target.value); setBlockId(""); }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Projects</option>
          {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={blockId} onChange={(e) => resetToFirstPage(setBlockId)(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Blocks</option>
          {blockOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {view === "grouped" && (
          <select value={invoicedStatus} onChange={(e) => resetToFirstPage(setInvoicedStatus)(e.target.value)}
            className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
            {INVOICED_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <input type="date" value={dateFrom} onChange={(e) => resetToFirstPage(setDateFrom)(e.target.value)}
          title="From date" className="px-2.5 py-2 text-sm border border-border rounded-lg bg-background" />
        <input type="date" value={dateTo} onChange={(e) => resetToFirstPage(setDateTo)(e.target.value)}
          title="To date" className="px-2.5 py-2 text-sm border border-border rounded-lg bg-background" />
        <button onClick={() => { setSearch(searchInput.trim()); setPage(1); }} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted">Search</button>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Clear filters</button>
        )}

        {/* Grouped (default, per-booking with progress) vs Flat (sortable,
            cross-booking table for Finance reconciliation) — same filter
            state and fetch, just a different render/pagination unit. */}
        <div className="flex items-center border border-border rounded-lg overflow-hidden ml-auto sm:ml-0">
          <button onClick={() => { setView("grouped"); setPage(1); }}
            title="Grouped by booking"
            className={`px-2.5 py-2 flex items-center gap-1.5 text-xs font-medium ${view === "grouped" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            <LayoutGrid size={13} /> Grouped
          </button>
          <button onClick={() => { setView("flat"); setPage(1); }}
            title="Flat, sortable table across all bookings"
            className={`px-2.5 py-2 flex items-center gap-1.5 text-xs font-medium border-l border-border ${view === "flat" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            <Rows3 size={13} /> Flat
          </button>
        </div>

        {rights.canCreate && (
          <button onClick={() => setGenBookingId(null)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Generate Invoice
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : view === "grouped" ? (
        groups.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-sm text-muted-foreground">No bookings match this filter combination.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.BookingId);
              const activeInvoices = g.Invoices.filter((i) => i.Status !== "Void");
              const invoicedTotal = activeInvoices.reduce((sum, i) => sum + Number(i.Amount || 0), 0);
              return (
                <div key={g.BookingId} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button onClick={() => toggleCollapsed(g.BookingId)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 text-left flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                      <Building2 size={14} className="text-primary shrink-0" />
                      <span className="font-mono text-sm font-semibold">{g.BookingNo}</span>
                      <span className="text-sm text-muted-foreground truncate">{g.ApplicantName}</span>
                      {g.ProjectName && <span className="text-xs text-muted-foreground truncate hidden sm:inline">· {g.ProjectName} {g.UnitNo}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <MilestoneProgressBar total={g.MilestoneTotal} invoiced={g.MilestoneInvoiced} />
                      <span className="text-muted-foreground">
                        {activeInvoices.length} invoice{activeInvoices.length !== 1 ? "s" : ""} · {fmtMoney(invoicedTotal)}
                        {g.Invoices.length > activeInvoices.length && ` (+${g.Invoices.length - activeInvoices.length} void)`}
                      </span>
                      {rights.canCreate && (
                        <span
                          onClick={(e) => { e.stopPropagation(); setGenBookingId(g.BookingId); }}
                          className="flex items-center gap-1 px-2 py-1 border border-border rounded-md font-medium hover:bg-muted">
                          <Plus size={12} /> Add
                        </span>
                      )}
                      <a href={`/crm/bookings?view=${g.BookingId}`} onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2 py-1 border border-border rounded-md font-medium hover:bg-muted">
                        <ExternalLink size={12} /> Booking
                      </a>
                    </div>
                  </button>
                  {!isCollapsed && (
                    g.Invoices.length === 0 ? (
                      <div className="border-t border-border px-4 py-4 text-xs text-muted-foreground">No invoices generated yet for this booking.</div>
                    ) : (
                    <div className="border-t border-border overflow-x-auto thin-scroll">
                      <table className="w-full text-sm min-w-[600px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/20">
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Invoice No.</th>
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Type</th>
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Amount</th>
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Date</th>
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Generated By</th>
                            <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.Invoices.map((inv) => {
                            const isVoid = inv.Status === "Void";
                            return (
                              <tr key={inv.Id} className={`border-b border-border last:border-0 hover:bg-muted/20 ${isVoid ? "opacity-60" : ""}`}>
                                <td className="px-3 py-1.5 font-mono text-xs font-semibold text-primary">
                                  <span className={isVoid ? "line-through" : ""}>{inv.InvoiceNo}</span>
                                  {isVoid && (
                                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 no-underline inline-block">Void</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5"><span className="text-xs px-2 py-0.5 rounded-md bg-muted font-medium">{inv.InvoiceType}</span></td>
                                <td className={`px-3 py-1.5 font-medium ${isVoid ? "line-through" : ""}`}>{fmtMoney(inv.Amount)}</td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(inv.InvoiceDate)}</td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground">{inv.CreatedByName || "—"}</td>
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => openInvoice(inv)}
                                      className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
                                      <FileText className="w-3 h-3" /> View
                                    </button>
                                    {!isVoid && canVoid && (
                                      <button onClick={() => setVoidTarget(inv)}
                                        className="flex items-center gap-1 px-2 py-1 text-xs border border-red-300 text-red-700 rounded-md hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30">
                                        <Ban className="w-3 h-3" /> Void
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )
                  )}
                </div>
              );
            })}
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        )
      ) : (
        // Flat mode — one sortable table across every booking, for
        // reconciliation. Click a header to sort by that column.
        flatRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-sm text-muted-foreground">No invoices match this filter combination.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {[
                      { key: "InvoiceNo", label: "Invoice No." },
                      { key: "BookingNo", label: "Booking" },
                      { key: "ApplicantName", label: "Customer" },
                      { key: "ProjectName", label: "Project / Unit" },
                      { key: "InvoiceType", label: "Type" },
                      { key: "Amount", label: "Amount" },
                      { key: "InvoiceDate", label: "Date" },
                    ].map((col) => (
                      <th key={col.key} onClick={() => toggleFlatSort(col.key)}
                        className="text-left px-3 py-2 text-xs text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground">
                        {col.label} {flatSort.key === col.key ? (flatSort.dir === "asc" ? "▲" : "▼") : ""}
                      </th>
                    ))}
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flatRows.map((inv) => {
                    const isVoid = inv.Status === "Void";
                    return (
                      <tr key={inv.Id} className={`border-b border-border last:border-0 hover:bg-muted/20 ${isVoid ? "opacity-60" : ""}`}>
                        <td className="px-3 py-1.5 font-mono text-xs font-semibold text-primary">
                          <span className={isVoid ? "line-through" : ""}>{inv.InvoiceNo}</span>
                          {isVoid && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 no-underline inline-block">Void</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{inv.BookingNo}</td>
                        <td className="px-3 py-1.5 text-xs truncate max-w-[160px]">{inv.ApplicantName}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[160px]">{inv.ProjectName || "—"} {inv.UnitNo}</td>
                        <td className="px-3 py-1.5"><span className="text-xs px-2 py-0.5 rounded-md bg-muted font-medium">{inv.InvoiceType}</span></td>
                        <td className={`px-3 py-1.5 font-medium ${isVoid ? "line-through" : ""}`}>{fmtMoney(inv.Amount)}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(inv.InvoiceDate)}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => openInvoice(inv)}
                              className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
                              <FileText className="w-3 h-3" /> View
                            </button>
                            {!isVoid && canVoid && (
                              <button onClick={() => setVoidTarget(inv)}
                                className="flex items-center gap-1 px-2 py-1 text-xs border border-red-300 text-red-700 rounded-md hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30">
                                <Ban className="w-3 h-3" /> Void
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3">
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            </div>
          </div>
        )
      )}

      {preview && <InvoicePreviewDialog invoice={preview} onClose={closeInvoice} />}
      {voidTarget && (
        <VoidInvoiceDialog
          invoice={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={() => { const bid = voidTarget.BookingId; setVoidTarget(null); invalidateInvoiceRelatedQueries(qc, bid); }}
        />
      )}
      {genBookingId !== undefined && (
        <GenerateInvoiceDialog initialBookingId={genBookingId} onClose={() => setGenBookingId(undefined)} onGenerated={handleGenerated} />
      )}
    </CrmShell>
    </>
  );
};

export default CrmInvoices;
