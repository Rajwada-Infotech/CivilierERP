import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { buildWorkbook, downloadBlob, type XlsxCell } from "@/lib/xlsxBook";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  Hourglass,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";

// Credit Notes — the GST document for money given back to a CRM customer
// (backend services/crmGstNotes.js, issued when a refund's payout is approved):
//   on invoices   — reduces an invoice (s.34), declare by 30 Nov after its FY
//   on advances   — money never invoiced (the legal form: refund voucher, Rule 51)
//   past deadline — no credit note possible; the buyer's GST-paid certificate
// Raised without a refund too: an invoice reduced (discount, area change, price
// correction) and the money kept — approved, it lowers the booking and moves
// anything already paid above the new amount to the customer's account.
// Cancelling needs a second person; the number is kept. "To issue" lists paid
// refunds that carried GST but have none yet.

const API = "/api/crm/refunds";
const PAGE_SIZE = 20;
const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const formatSac = (hsn: any) => {
  if (!hsn) return "9954";
  const s = String(hsn).trim();
  const m = s.match(/^(\d{4,6})/);
  return m ? m[1] : s;
};

async function getJson(url: string, init?: RequestInit) {
  const r = await fetchWithAuth(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

type Kind = "invoice" | "advance" | "barred" | "cancelled" | "request";
const kindOf = (n: any): Kind =>
  ["Draft", "Pending", "Rejected"].includes(n.Status)
    ? "request"
    : n.Status === "Cancelled"
    ? "cancelled"
    : n.Status === "TimeBarred"
    ? "barred"
    : n.DocType === "CreditNote"
    ? "invoice"
    : "advance";

const REASON_LABEL: Record<string, string> = {
  Discount: "Discount",
  AreaChange: "Area change",
  PriceCorrection: "Price correction",
  Other: "Other",
};
const REQ_LABEL: Record<string, string> = {
  Draft: "Being prepared",
  Pending: "Waiting for approval",
  Rejected: "Sent back",
};
const KIND: Record<Kind, { label: string; short: string; cls: string }> = {
  invoice: {
    label: "Credit note — on invoice",
    short: "On invoice",
    cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",
  },
  advance: {
    label: "Credit note — on advance (refund voucher)",
    short: "On advance",
    cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900",
  },
  barred: {
    label: "Past deadline — GST paid certificate",
    short: "Past deadline",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
  },
  cancelled: {
    label: "Cancelled",
    short: "Cancelled",
    cls: "bg-muted text-muted-foreground border-border line-through",
  },
  request: {
    label: "Credit note — invoice reduced (pending)",
    short: "Awaiting approval",
    cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900",
  },
};
const TABS = [
  ["all", "All"],
  ["request", "Awaiting approval"],
  ["invoice", "On invoices"],
  ["advance", "On advances"],
  ["barred", "Past deadline"],
  ["cancelled", "Cancelled"],
  ["pending", "To issue"],
] as const;
type Tab = (typeof TABS)[number][0];

function periods() {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    month: [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)],
    last: [
      ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    ],
    fy: [`${fyStart}-04-01`, ymd(now)],
    lastfy: [`${fyStart - 1}-04-01`, `${fyStart}-03-31`],
  } as Record<string, [string, string]>;
}
const PERIOD_LABEL: Record<string, string> = {
  month: "This month",
  last: "Last month",
  fy: "This financial year",
  lastfy: "Last financial year",
  custom: "Custom",
};

/** Days to the declare-by date of a credit note on an invoice. */
function deadlineChip(n: any) {
  if (kindOf(n) !== "invoice" || !n.DeadlineDate) return null;
  const days = Math.ceil((new Date(n.DeadlineDate).getTime() - Date.now()) / 864e5);
  const cls = days < 0 ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-[0.6875rem] ${cls}`}>
      <CalendarClock size={11} />
      {days < 0 ? `passed ${day(n.DeadlineDate)}` : `declare by ${day(n.DeadlineDate)} (${days}d)`}
    </span>
  );
}

function PdfPreview({ id, version }: { id: number; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchWithAuth(`${API}/gst-notes/${id}/pdf`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        u = URL.createObjectURL(await r.blob());
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, version]);
  if (failed) return <p className="p-6 text-sm text-red-600">Couldn't load the PDF — refresh and try again.</p>;
  if (!url) return <p className="p-6 text-sm text-muted-foreground">Preparing the PDF…</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-end">
        <a
          href={url}
          download
          className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"
        >
          <Download size={13} />
          Download
        </a>
        <button
          onClick={() => {
            const w = window.open(url, "_blank");
            w?.addEventListener("load", () => w.print());
          }}
          className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"
        >
          <Printer size={13} />
          Print
        </button>
      </div>
      <iframe
        title="Credit note PDF"
        src={url}
        className="w-full h-[65vh] min-h-[480px] rounded-lg border border-border bg-white"
      />
    </div>
  );
}

/** Raise a credit note on an invoice, without a refund. */
function NewCreditNoteDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["crm-creditable-invoices", search],
    queryFn: () => getJson(`${API}/gst-notes/creditable-invoices?search=${encodeURIComponent(search)}`),
  });
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reasonType, setReasonType] = useState("Discount");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = invoices.find((x) => String(x.Id) === invoiceId);
  const amt = Number(amount || 0);
  const tooMuch = !!inv && amt > Number(inv.Open) + 0.005;

  const save = async () => {
    setBusy(true);
    try {
      const r = await getJson(`${API}/gst-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          InvoiceId: Number(invoiceId),
          Amount: amt,
          ReasonType: reasonType,
          Remarks: remarks,
        }),
      });
      toast.success("Credit note prepared — check it, then send it for approval");
      onCreated(r.Id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const label = "block text-xs font-medium text-muted-foreground mb-1";
  const input =
    "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New credit note — invoice reduced</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            For a discount, area change or price correction where the money stays with us. Money paid back is a refund —
            its credit note comes automatically with the refund.
          </p>
          <div>
            <label className={label}>Invoice</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice no., booking, unit or customer…"
              className={`${input} mb-2`}
            />
            <SearchableSelect
              value={invoiceId}
              onChange={(v) => {
                setInvoiceId(v);
                setAmount("");
              }}
              placeholder={
                isLoading
                  ? "Loading…"
                  : invoices.length
                  ? "Choose the invoice"
                  : "No invoice can take a credit note"
              }
              searchPlaceholder="Filter…"
              options={invoices.map((x) => ({
                value: String(x.Id),
                label: `${x.InvoiceNo} · ${x.Property} · ${x.CustomerName} · ${inr(x.Open)} left`,
              }))}
            />
            {inv && (
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Invoice {inr(inv.Amount)} on {day(inv.InvoiceDate)} · up to {inr(inv.Open)} can be credited · declare by{" "}
                {day(inv.Deadline)}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Amount (incl. GST)</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${input} ${tooMuch ? "border-red-500" : ""}`}
              />
              {tooMuch && <p className="mt-1 text-[0.6875rem] text-red-600">At most {inr(inv?.Open)}</p>}
            </div>
            <div>
              <label className={label}>Why</label>
              <select value={reasonType} onChange={(e) => setReasonType(e.target.value)} className={input}>
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>What changed (printed on the credit note)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="e.g. Festive discount agreed on 12 Oct; super built-up area revised from 1,250 to 1,232 sq ft"
              className={`${input} h-auto py-2`}
            />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">
            On approval: the booking's value and this invoice's milestone come down by the amount; whatever the customer
            already paid above the new amount moves to their account as credit.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg border border-border hover:bg-muted">
              Close
            </button>
            <button
              onClick={save}
              disabled={busy || !inv || !(amt > 0) || tooMuch || !remarks.trim()}
              className="h-9 px-4 rounded-lg btn-module text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Prepare credit note"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A raised credit note before it is issued: edit, send for approval, approve / send back. */
function RequestPanel({ n, canEdit, refresh }: { n: any; canEdit: boolean; refresh: () => void }) {
  const [amount, setAmount] = useState(String(n.TotalAmount ?? ""));
  const [reasonType, setReasonType] = useState(n.ReasonType || "Discount");
  const [remarks, setRemarks] = useState(n.Remarks || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const editable = canEdit && ["Draft", "Rejected"].includes(n.Status);
  const dirty =
    Number(amount) !== Number(n.TotalAmount) ||
    reasonType !== n.ReasonType ||
    remarks !== (n.Remarks || "");
  const run = async (key: string, url: string, body: any, ok: string) => {
    setBusy(key);
    try {
      await getJson(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      toast.success(ok);
      setNote("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };
  const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background disabled:opacity-70";
  return (
    <div className="rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/40 dark:bg-orange-950/10 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{REQ_LABEL[n.Status]}</h3>
        <span className="text-xs text-muted-foreground">
          Raised {day(n.RequestedAt || n.CreatedAt)}
          {n.CreatedBy ? ` by ${n.CreatedBy}` : ""}
        </span>
      </div>
      {n.Status === "Rejected" && n.RejectionNote && (
        <p className="text-xs text-red-600">Sent back: {n.RejectionNote}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">
          Amount (incl. GST)
          <input
            type="number"
            disabled={!editable}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={input}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Why
          <select
            disabled={!editable}
            value={reasonType}
            onChange={(e) => setReasonType(e.target.value)}
            className={input}
          >
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-muted-foreground">
          Declare by<div className="h-9 flex items-center text-sm text-foreground">{day(n.DeadlineDate)}</div>
        </div>
      </div>
      <label className="block text-xs text-muted-foreground">
        What changed
        <textarea
          disabled={!editable}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          className={`${input} h-auto py-2`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {editable && (
          <button
            disabled={!dirty || !!busy}
            onClick={() =>
              run(
                "save",
                `${API}/gst-notes/${n.Id}`,
                { Amount: Number(amount), ReasonType: reasonType, Remarks: remarks },
                "Saved"
              )
            }
            className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40"
          >
            Save
          </button>
        )}
        {editable && (
          <button
            disabled={dirty || !!busy}
            title={dirty ? "Save your changes first" : undefined}
            onClick={() => run("submit", `${API}/gst-notes/${n.Id}/submit`, null, "Sent for approval")}
            className="h-8 px-3 text-xs rounded-lg btn-module text-white inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Send size={12} />
            {n.Status === "Rejected" ? "Send again" : "Send for approval"}
          </button>
        )}
      </div>
      {canEdit && n.Status === "Pending" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Approvers: approve here or in the Approval Inbox. Whoever raised it can't approve it.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Remarks (needed to send back)"
            className={`${input} h-auto py-2`}
          />
          <div className="flex gap-2">
            <button
              disabled={!!busy}
              onClick={() => run("approve", `${API}/gst-notes/${n.Id}/approve`, { note }, "Approved — credit note issued")}
              className="h-8 px-3 text-xs rounded-lg bg-green-600 text-white inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <ShieldCheck size={12} />
              Approve
            </button>
            <button
              disabled={!!busy || !note.trim()}
              onClick={() => run("reject", `${API}/gst-notes/${n.Id}/reject`, { note }, "Sent back")}
              className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40"
            >
              Send back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Detail Dialog with PDF preview, tax splits, and lineage */
function DetailDialog({
  id,
  canEdit,
  onClose,
  onChanged,
}: {
  id: number;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: n, isLoading, isError, error } = useQuery<any>({
    queryKey: ["crm-credit-note", id],
    queryFn: () => getJson(`${API}/gst-notes/${id}`),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md p-10 text-center text-sm text-muted-foreground">
          Loading credit note details…
        </DialogContent>
      </Dialog>
    );

  if (isError || !n)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md p-10 text-center text-sm text-red-600">
          {(error as any)?.message || "Credit note not found"}
        </DialogContent>
      </Dialog>
    );

  const k = kindOf(n);
  const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
  const norm = (x: any) => String(x || "").trim().toLowerCase();
  const sameState = !n.ProjectState || !n.CompanyState || norm(n.ProjectState) === norm(n.CompanyState);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-credit-note"] });
    onChanged();
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await getJson(`${API}/gst-notes/${id}/cancel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      toast.success("Cancellation sent for approval");
      setCancelOpen(false);
      setReason("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const decideCancel = async (approve: boolean) => {
    setBusy(true);
    try {
      await getJson(`${API}/gst-notes/cancel-requests/${id}/${approve ? "approve" : "reject"}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: reason }),
      });
      toast.success(approve ? "Cancellation approved" : "Cancellation turned down");
      setReason("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doReissue = async () => {
    setBusy(true);
    try {
      await getJson(`${API}/${n.RefundId}/gst-notes/reissue`, { method: "POST" });
      toast.success("Re-issued");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const banner =
    k === "invoice" ? (
      <>
        Reduces invoice <b>{n.AgainstRef}</b>. Declare it in GSTR-1 by <b>{day(n.DeadlineDate)}</b> (or the annual return);
        the GST below comes off what we owe.
      </>
    ) : k === "advance" ? (
      <>
        The money came in as an advance with GST and was never invoiced, so it is given back on a refund voucher.
        Its GST comes off the advances we paid tax on.
      </>
    ) : k === "barred" ? (
      <>
        Invoice <b>{n.AgainstRef}</b> is past its declare-by date ({day(n.DeadlineDate)}), so no credit note can be issued.
        Give the buyer this GST-paid certificate — they claim the GST from the department (Circular 188/20/2022).
      </>
    ) : k === "request" ? (
      <>
        A credit note on invoice <b>{n.AgainstRef}</b> for {REASON_LABEL[n.ReasonType] || "a reduction"}: {n.Remarks}
      </>
    ) : (
      <>
        Cancelled {day(n.CancelledAt)}
        {n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}. Its number stays in the series.
        {n.ReplacedByNo ? (
          <>
            {" "}
            Replaced by <b>{n.ReplacedByNo}</b>.
          </>
        ) : null}
      </>
    );

  const allCancelled = k === "cancelled" && !(n.siblings || []).some((s: any) => s.Status !== "Cancelled");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4 font-mono">
            <span>{n.DocNo || (k === "request" ? "Not issued yet" : "Certificate")}</span>
            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-sans font-medium ${KIND[k].cls}`}>
              {KIND[k].label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <div className="text-sm font-semibold">
                {n.CustomerName}
                {n.CustomerGst ? (
                  <span className="ml-1.5 text-[0.6875rem] font-mono font-normal px-1.5 py-0.5 rounded border border-border">GSTIN {n.CustomerGst}</span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {n.Property} · {n.ProjectName || ""} · Booking {n.BookingNo}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums">{inr(n.TotalAmount)}</div>
              <div className="text-xs text-muted-foreground">
                GST {inr(n.GstAmount)}
                {n.GstRate != null ? ` @ ${Number(n.GstRate)}%` : ""} · {day(n.DocDate)}
              </div>
            </div>
          </div>

          <p
            className={`text-xs rounded-lg px-3 py-2.5 ${
              k === "barred"
                ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                : k === "cancelled"
                ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"
                : "bg-muted/40"
            }`}
          >
            {banner}
          </p>

          <div className="flex flex-wrap gap-2">
            {canEdit && ["invoice", "advance", "barred"].includes(k) && n.CancelApprovalStatus !== "Pending" && (
              <button
                onClick={() => setCancelOpen(true)}
                className="h-8 px-3 text-xs rounded-lg border border-border text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
              >
                <Ban size={13} />
                Cancel…
              </button>
            )}
            {canEdit && allCancelled && !n.ReplacedByNo && (
              <button
                onClick={doReissue}
                disabled={busy}
                className="h-8 px-3 text-xs rounded-lg btn-module text-white inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCcw size={13} />
                Re-issue
              </button>
            )}
            {n.RefundNo && (
              <Link
                to={`/crm/refunds?search=${encodeURIComponent(n.RefundNo)}`}
                className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"
              >
                Refund {n.RefundNo} <ExternalLink size={11} />
              </Link>
            )}
            <Link
              to={`/crm/bookings?view=${n.BookingId}`}
              className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"
            >
              Booking {n.BookingNo} <ExternalLink size={11} />
            </Link>
            {n.InvoiceId && (
              <Link
                to={`/crm/invoices?invoiceId=${n.InvoiceId}`}
                className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"
              >
                Invoice {n.AgainstRef} <ExternalLink size={11} />
              </Link>
            )}
          </div>

          {n.CancelApprovalStatus === "Pending" && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20 p-3 text-sm space-y-2">
              <div>
                <b>Cancellation requested</b> {day(n.CancelRequestedAt)} — {n.CancelRequestReason}. Waiting for approval.
              </div>
              {canEdit && (
                <>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Remarks (needed to keep it)"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => decideCancel(true)}
                      disabled={busy}
                      className="h-8 px-3 text-xs rounded-lg bg-red-600 text-white disabled:opacity-40"
                    >
                      Approve cancellation
                    </button>
                    <button
                      onClick={() => decideCancel(false)}
                      disabled={busy || !reason.trim()}
                      className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40"
                    >
                      Keep it
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {k === "request" && <RequestPanel n={n} canEdit={canEdit} refresh={refresh} />}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-xl border border-border bg-card p-4">
              <PdfPreview id={id} version={`${n.Status}${n.CancelledAt || ""}`} />
            </div>
            <aside className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-2">
                <h3 className="text-sm font-semibold mb-1">Amounts</h3>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxable value</span>
                  <span className="tabular-nums">{inr(n.TaxableValue)}</span>
                </div>
                {sameState ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">CGST</span>
                      <span className="tabular-nums">{inr(half)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SGST</span>
                      <span className="tabular-nums">{inr(Number(n.GstAmount) - half)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IGST</span>
                    <span className="tabular-nums">{inr(n.GstAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-border pt-1.5">
                  <span>Total</span>
                  <span className="tabular-nums">{inr(n.TotalAmount)}</span>
                </div>
                <div className="text-[0.6875rem] text-muted-foreground pt-1">
                  Place of supply: {n.ProjectState || n.CompanyState || "where the property is"} · HSN/SAC{" "}
                  {formatSac(n.HsnCode)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-2">
                <h3 className="text-sm font-semibold mb-1">Where it comes from</h3>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Against</span>
                  <span className="text-right">
                    {n.AgainstRef || "—"}
                    {n.AgainstDate ? ` · ${day(n.AgainstDate)}` : ""}
                  </span>
                </div>
                {n.RefundNo ? (
                  <>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Refund</span>
                      <span>
                        {n.RefundNo} · paid {day(n.RefundPaidAt)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Refund paid</span>
                      <span className="tabular-nums">{inr(n.RefundNet)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Why</span>
                      <span>{REASON_LABEL[n.ReasonType] || "—"}</span>
                    </div>
                    {Number(n.MovedToAccount) > 0 && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Moved to account</span>
                        <span className="tabular-nums">{inr(n.MovedToAccount)}</span>
                      </div>
                    )}
                  </>
                )}
                {Number(n.RefundKept) > 0 && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Kept as charges</span>
                    <span className="tabular-nums">{inr(n.RefundKept)} (no credit note)</span>
                  </div>
                )}
                {n.RefundReason && <div className="text-muted-foreground pt-1 italic">“{n.RefundReason}”</div>}
              </div>

              {(n.siblings || []).length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 text-xs">
                  <h3 className="text-sm font-semibold mb-2">Same refund documents</h3>
                  <ul className="space-y-1.5">
                    {n.siblings.map((x: any) => (
                      <li key={x.Id}>
                        <button
                          onClick={() => {
                            qc.invalidateQueries({ queryKey: ["crm-credit-note", x.Id] });
                          }}
                          className="w-full flex justify-between gap-2 hover:underline text-left"
                        >
                          <span>
                            {KIND[kindOf(x)].short} <span className="font-mono text-muted-foreground">{x.DocNo}</span>
                          </span>
                          <span className="tabular-nums">{inr(x.TotalAmount)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1.5">
                <h3 className="text-sm font-semibold mb-1">History</h3>
                <div>
                  {n.Source === "Adjustment" ? "Raised" : "Issued"} {day(n.CreatedAt)}
                  {n.CreatedBy ? ` by ${n.CreatedBy}` : ""}
                  {n.ReplacesNo ? ` — replaces ${n.ReplacesNo}` : ""}
                </div>
                {n.ApprovedAt && <div>Approved and issued {day(n.ApprovedAt)}</div>}
                {n.CancelRequestedAt && (
                  <div>
                    Cancellation requested {day(n.CancelRequestedAt)} — {n.CancelRequestReason}
                  </div>
                )}
                {n.CancelledAt && (
                  <div className="text-red-600">
                    Cancelled {day(n.CancelledAt)}
                    {n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}
                  </div>
                )}
                {n.ReplacedByNo && <div>Replaced by {n.ReplacedByNo}</div>}
              </div>
            </aside>
          </div>
        </div>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Ask to cancel {n.DocNo || "this certificate"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground text-xs">
                {n.RefundNo
                  ? `Every credit note of refund ${n.RefundNo} is cancelled together; you can re-issue afterwards.`
                  : "The booking value, milestone, and customer's account go back as they were."}{" "}
                A second person must approve the cancellation.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is it being cancelled?"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCancelOpen(false)}
                  className="h-9 px-4 rounded-lg border border-border hover:bg-muted"
                >
                  Keep it
                </button>
                <button
                  onClick={doCancel}
                  disabled={busy || !reason.trim()}
                  className="h-9 px-4 rounded-lg bg-red-600 text-white disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Ask to cancel"}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function PendingList({
  canEdit,
  onIssued,
}: {
  canEdit: boolean;
  onIssued: (firstId?: number) => void;
}) {
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["crm-credit-notes-pending"],
    queryFn: () => getJson(`${API}/gst-notes/pending`),
  });
  const [busy, setBusy] = useState<number | null>(null);

  const issue = async (refundId: number, re: boolean) => {
    setBusy(refundId);
    try {
      const out = await getJson(`${API}/${refundId}/gst-notes${re ? "/reissue" : ""}`, { method: "POST" });
      toast.success("Credit note issued");
      onIssued(Array.isArray(out) ? out.find((x: any) => x.Status !== "Cancelled")?.Id : undefined);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground p-6">Loading pending refunds…</p>;
  if (!data.length)
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <CheckCircle2 size={18} className="mx-auto mb-2 text-green-600" />
        Every paid refund that carried GST has its credit note.
      </div>
    );

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border">
      <p className="p-4 text-xs text-muted-foreground">
        Paid refunds on bookings that were charged GST, without a live credit note — paid before credit notes existed, or
        their credit note was cancelled.
      </p>
      {data.map((r) => (
        <div key={r.RefundId} className="p-4 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex-1 min-w-48">
            <div className="font-medium">
              {r.CustomerName} <span className="font-normal text-muted-foreground">· {r.Property} · {r.ProjectName || ""}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {r.RefundNo} · paid {day(r.PaidAt)} · {r.SourceType}
              {r.CancelledCount ? " · earlier credit note cancelled" : ""}
            </div>
          </div>
          <div className="tabular-nums font-semibold">{inr(r.NetAmount)}</div>
          {canEdit && (
            <button
              onClick={() => issue(r.RefundId, !!r.CancelledCount)}
              disabled={busy === r.RefundId}
              className="h-8 px-3 text-xs rounded-lg btn-module text-white disabled:opacity-40"
            >
              {busy === r.RefundId ? "Issuing…" : r.CancelledCount ? "Re-issue" : "Issue credit note"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const CrmCreditNotes: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-refunds");
  const [sp, setSp] = useSearchParams();

  const [selectedId, setSelectedId] = useState<number | null>(sp.get("id") ? Number(sp.get("id")) : null);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("fy");
  const P = periods();
  const [custom, setCustom] = useState<[string, string]>(P.month);
  const [from, to] = period === "custom" ? custom : P[period];
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // Enterprise scoping: Company / Project / Block
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({
    companyId: "",
    projectId: "",
    blockId: "",
  });

  // Query paginated list
  const { data: listResponse, isLoading, isFetching, dataUpdatedAt } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["crm-gst-notes", from, to, tab, page, search, cpb.companyId, cpb.projectId],
    queryFn: async () => {
      const q = new URLSearchParams({
        from,
        to,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (tab !== "all" && tab !== "pending") q.set("status", tab);
      if (search.trim()) q.set("search", search.trim());
      if (cpb.companyId) q.set("companyId", cpb.companyId);
      if (cpb.projectId) q.set("projectId", cpb.projectId);
      const res = await getJson(`${API}/gst-notes?${q.toString()}`);
      return Array.isArray(res) ? { rows: res, total: res.length } : res;
    },
    enabled: tab !== "pending",
  });

  const rows = listResponse?.rows || [];
  const total = listResponse?.total || 0;

  // Query pending unissued refunds count
  const { data: pending = [] } = useQuery<any[]>({
    queryKey: ["crm-credit-notes-pending"],
    queryFn: () => getJson(`${API}/gst-notes/pending`),
  });

  // Summary query for KPI counters across the entire active date range
  const { data: allNotes = [] } = useQuery<any[]>({
    queryKey: ["crm-gst-notes-all-kpis", from, to, cpb.companyId, cpb.projectId],
    queryFn: async () => {
      const q = new URLSearchParams({ from, to });
      if (cpb.companyId) q.set("companyId", cpb.companyId);
      if (cpb.projectId) q.set("projectId", cpb.projectId);
      const res = await getJson(`${API}/gst-notes?${q.toString()}`);
      return Array.isArray(res) ? res : res.rows || [];
    },
  });

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["crm-gst-notes"] });
    qc.invalidateQueries({ queryKey: ["crm-credit-notes-pending"] });
    qc.invalidateQueries({ queryKey: ["crm-gst-notes-all-kpis"] });
    qc.invalidateQueries({ queryKey: ["crm-credit-note"] });
  };

  // ?refundId= query parameter opens that refund's first live credit note
  const refundParam = sp.get("refundId");
  const { data: refundNotes } = useQuery<any[]>({
    queryKey: ["crm-refund-gst-notes", refundParam],
    queryFn: () => getJson(`${API}/${refundParam}/gst-notes`),
    enabled: !!refundParam,
  });

  useEffect(() => {
    if (!refundParam || !refundNotes) return;
    const first = refundNotes.find((x: any) => x.Status !== "Cancelled") || refundNotes[0];
    setSp(
      (p) => {
        p.delete("refundId");
        if (first) p.set("id", String(first.Id));
        return p;
      },
      { replace: true }
    );
    if (first) setSelectedId(first.Id);
    else setTab("pending");
  }, [refundParam, refundNotes, setSp]);

  const sum = (k: Kind) =>
    allNotes.filter((n) => kindOf(n) === k).reduce((s, n) => s + Number(n.GstAmount || 0), 0);
  const count = (k: Kind) => allNotes.filter((n) => kindOf(n) === k).length;
  const dueSoon = allNotes.filter(
    (n) =>
      kindOf(n) === "invoice" &&
      n.DeadlineDate &&
      (new Date(n.DeadlineDate).getTime() - Date.now()) / 864e5 <= 30 &&
      new Date(n.DeadlineDate).getTime() >= Date.now()
  ).length;

  const exportXlsx = async () => {
    const q = new URLSearchParams({ from, to });
    if (cpb.companyId) q.set("companyId", cpb.companyId);
    if (cpb.projectId) q.set("projectId", cpb.projectId);
    const dataForExport = await getJson(`${API}/gst-notes?${q.toString()}`);
    const exportRows: any[] = Array.isArray(dataForExport) ? dataForExport : dataForExport.rows || [];

    const live = exportRows.filter((n) => ["invoice", "advance"].includes(kindOf(n)));
    const norm = (x: any) => String(x || "").trim().toLowerCase();
    const split = (n: any) => {
      const same = !n.ProjectState || !n.CompanyState || norm(n.ProjectState) === norm(n.CompanyState);
      const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
      return same ? [half, Number(n.GstAmount) - half, 0] : [0, 0, Number(n.GstAmount)];
    };
    const H = (v: string): XlsxCell => ({ v, s: "header" });
    const detail: XlsxCell[][] = [
      [
        "Type",
        "No.",
        "Date",
        "Status",
        "Customer",
        "Buyer GSTIN",
        "Property",
        "Booking",
        "Against",
        "Against date",
        "HSN/SAC",
        "Rate %",
        "Taxable value",
        "CGST",
        "SGST",
        "IGST",
        "Total",
        "Declare by",
        "Refund",
        "Cancelled reason",
      ].map(H),
      ...exportRows
        .filter((n) => kindOf(n) !== "request")
        .map((n) => {
          const [c, s, i] = split(n);
          return [
            KIND[kindOf(n)].label,
            n.DocNo || "",
            String(n.DocDate).slice(0, 10),
            n.Status,
            n.CustomerName || "",
            n.CustomerGst || "",
            n.Property,
            n.BookingNo,
            n.AgainstRef || "",
            n.AgainstDate ? String(n.AgainstDate).slice(0, 10) : "",
            formatSac(n.HsnCode),
            n.GstRate != null ? Number(n.GstRate) : "",
            Number(n.TaxableValue),
            c,
            s,
            i,
            Number(n.TotalAmount),
            n.DeadlineDate ? String(n.DeadlineDate).slice(0, 10) : "",
            n.RefundNo,
            n.CancelReason || "",
          ];
        }),
    ];
    const groups = new Map<string, number[]>();
    for (const n of live) {
      // GSTR-1: a registered buyer's credit note goes to CDNR (they see it in
      // their GSTR-2B), an individual's to CDNUR / B2C.
      const key = `${
        kindOf(n) === "invoice"
          ? n.CustomerGst
            ? "Credit notes — registered buyers (GSTR-1 CDNR)"
            : "Credit notes — unregistered buyers (GSTR-1 CDNUR / B2C)"
          : "Refund vouchers on advances (GSTR-1 advance adjustment)"
      }|${Number(n.GstRate || 0)}`;
      const g = groups.get(key) || [0, 0, 0, 0, 0, 0];
      const [c, s, i] = split(n);
      groups.set(key, [
        g[0] + 1,
        g[1] + Number(n.TaxableValue),
        g[2] + c,
        g[3] + s,
        g[4] + i,
        g[5] + Number(n.TotalAmount),
      ]);
    }
    const summary: XlsxCell[][] = [
      [{ v: `Credit notes ${from} to ${to} — cancelled and past-deadline ones excluded`, s: "title" }],
      [],
      ["Where it goes", "Rate %", "Documents", "Taxable value", "CGST", "SGST", "IGST", "Total"].map(H),
      ...[...groups.entries()].map(([k, g]) => {
        const [where, rate] = k.split("|");
        return [where, Number(rate), g[0], ...g.slice(1).map((x) => Math.round(x * 100) / 100)];
      }),
    ];
    downloadBlob(
      await buildWorkbook([
        { name: "GSTR-1 summary", rows: summary, widths: [58, 8, 10, 16, 14, 14, 14, 16] },
        {
          name: "Credit notes",
          rows: detail,
          widths: [34, 16, 12, 11, 24, 17, 18, 16, 22, 12, 10, 8, 14, 12, 12, 12, 14, 12, 16, 30],
          freezeBelowRow: 2,
        },
      ]),
      `Credit-notes-${from}-to-${to}.xlsx`
    );
  };

  const columns: ColumnDef<any>[] = [
    {
      header: "Doc No",
      cell: ({ row }) => {
        const n = row.original;
        const k = kindOf(n);
        return (
          <div className="flex flex-col">
            <button
              onClick={() => setSelectedId(n.Id)}
              className="text-left font-mono font-semibold text-primary hover:underline"
            >
              {n.DocNo || (k === "request" ? REQ_LABEL[n.Status] : "Certificate")}
            </button>
            {n.CancelApprovalStatus === "Pending" && (
              <span className="text-[0.625rem] text-red-600 font-medium">Cancellation asked</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Date",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{day(row.original.DocDate)}</span>
      ),
    },
    {
      header: "Type",
      cell: ({ row }) => {
        const k = kindOf(row.original);
        return (
          <span
            className={`inline-flex items-center text-[0.625rem] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${KIND[k].cls}`}
          >
            {KIND[k].short}
          </span>
        );
      },
    },
    {
      header: "Customer & Unit",
      cell: ({ row }) => {
        const n = row.original;
        return (
          <div className="flex flex-col max-w-[200px]">
            <span className="font-medium truncate text-xs">{n.CustomerName || "—"}</span>
            <span className="text-[0.6875rem] text-muted-foreground truncate">
              {n.Property} · {n.BookingNo}
            </span>
          </div>
        );
      },
    },
    {
      header: "Project",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
          {row.original.ProjectName || "—"}
        </span>
      ),
    },
    {
      header: "Against Reference",
      cell: ({ row }) => {
        const n = row.original;
        const ref = n.AgainstRef || n.RefundNo || "—";
        return (
          <div className="flex flex-col max-w-[160px]">
            <span className="text-xs font-mono truncate" title={ref}>
              {ref}
            </span>
            {n.AgainstDate && (
              <span className="text-[0.6875rem] text-muted-foreground">{day(n.AgainstDate)}</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Taxable Value",
      cell: ({ row }) => <span className="text-xs tabular-nums">{inr(row.original.TaxableValue)}</span>,
    },
    {
      header: "GST",
      cell: ({ row }) => {
        const n = row.original;
        return (
          <div className="flex flex-col">
            <span className="text-xs tabular-nums font-medium">{inr(n.GstAmount)}</span>
            <span className="text-[0.6875rem] text-muted-foreground">
              {n.GstRate != null ? `${Number(n.GstRate)}%` : ""}
            </span>
          </div>
        );
      },
    },
    {
      header: "Total",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums font-semibold">{inr(row.original.TotalAmount)}</span>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => {
        const n = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span
              className={`inline-flex items-center text-[0.625rem] px-2 py-0.5 rounded-full border font-medium w-fit ${
                n.Status === "Issued"
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900"
                  : n.Status === "Pending"
                  ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900"
                  : n.Status === "TimeBarred"
                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"
                  : n.Status === "Cancelled"
                  ? "bg-muted text-muted-foreground border-border line-through"
                  : "bg-slate-50 text-slate-700 border-slate-200"
              }`}
            >
              {n.Status}
            </span>
            {deadlineChip(n)}
          </div>
        );
      },
    },
    {
      header: "Actions",
      cell: ({ row }) => {
        const n = row.original;
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(n.Id);
              }}
              className="h-7 px-2.5 text-xs rounded border border-border hover:bg-muted inline-flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium"
            >
              <Eye size={12} />
              View
            </button>
          </div>
        );
      },
    },
  ];

  const kpi = (
    label: string,
    value: string,
    sub: string,
    icon: React.ReactNode,
    onClick?: () => void,
    tone = ""
  ) => (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors ${tone}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-1">{value}</div>
      <div className="text-[0.6875rem] text-muted-foreground">{sub}</div>
    </button>
  );

  return (
    <CrmShell
      title="Credit Notes"
      subtitle="GST credit notes & refund vouchers for CRM customer adjustments and refunds"
      action={
        <div className="flex items-center gap-2">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={reload} />
          {rights.canCreate && (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-3 py-1.5 rounded-lg btn-module"
            >
              <Plus size={13} />
              New credit note
            </button>
          )}
          <button
            onClick={exportXlsx}
            disabled={!allNotes.length}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <FileDown size={13} />
            Excel for GST return
          </button>
        </div>
      }
    >
      <Breadcrumbs items={["CRM", "Finance", "Credit Notes"]} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {kpi(
          "On invoices",
          inr(sum("invoice")),
          `GST reduced · ${count("invoice")} note${count("invoice") === 1 ? "" : "s"}${
            dueSoon ? ` · ${dueSoon} due in 30d` : ""
          }`,
          <FileText size={13} />,
          () => {
            setTab("invoice");
            setPage(1);
          }
        )}
        {kpi(
          "On advances",
          inr(sum("advance")),
          `GST on advances refunded · ${count("advance")} voucher${count("advance") === 1 ? "" : "s"}`,
          <FileText size={13} />,
          () => {
            setTab("advance");
            setPage(1);
          }
        )}
        {kpi(
          "Past deadline",
          inr(sum("barred")),
          `GST certificates · ${count("barred")} for buyer claim`,
          <AlertTriangle size={13} />,
          () => {
            setTab("barred");
            setPage(1);
          }
        )}
        {kpi(
          "To issue",
          String(pending.length),
          pending.length ? "paid refunds waiting for credit notes" : "all issued",
          <Hourglass size={13} />,
          () => setTab("pending"),
          pending.length ? "ring-1 ring-amber-300 dark:ring-amber-800" : ""
        )}
      </div>

      {/* Period Filter & Status Tabs */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.keys(PERIOD_LABEL).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                  period === p
                    ? "btn-module text-white border-transparent"
                    : "bg-background border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
            {period === "custom" && (
              <div className="flex items-center gap-1 ml-2">
                <input
                  type="date"
                  value={custom[0]}
                  onChange={(e) => {
                    setCustom([e.target.value, custom[1]]);
                    setPage(1);
                  }}
                  className="h-8 px-2 text-xs border border-border rounded-lg bg-background"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={custom[1]}
                  onChange={(e) => {
                    setCustom([custom[0], e.target.value]);
                    setPage(1);
                  }}
                  className="h-8 px-2 text-xs border border-border rounded-lg bg-background"
                />
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {day(from)} – {day(to)}
          </span>
        </div>

        {/* Tab Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map(([k, l]) => {
            const n =
              k === "pending"
                ? pending.length
                : k === "all"
                ? allNotes.length
                : count(k as Kind);
            if (k === "request" && !n) return null;
            return (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  tab === k
                    ? "btn-module text-white border-transparent shadow-sm"
                    : "bg-background border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {l}
                {n ? ` · ${n}` : ""}
              </button>
            );
          })}
        </div>

        {/* Search & Enterprise Filters */}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by doc no, customer, property, booking, refund, or invoice…"
              className="w-full h-9 pl-8 pr-3 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <CrmCompanyProjectBlockFilter
            value={cpb}
            onChange={(v) => {
              setCpb(v);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Main View: Pending Refunds or DataTable */}
      {tab === "pending" ? (
        <PendingList
          canEdit={rights.canEdit}
          onIssued={(id) => {
            reload();
            if (id) {
              setTab("all");
              setSelectedId(id);
            }
          }}
        />
      ) : (
        <div className="space-y-2">
          <DataTable
            data={rows}
            columns={columns}
            searchable={false}
            paginated={false}
            onRowClick={(row) => setSelectedId(row.original.Id)}
            loading={isLoading}
            emptyMessage="No credit notes found for the selected period and filters."
            className="rounded-xl border border-border overflow-hidden bg-card"
          />
          <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}

      {/* Detail Dialog */}
      {selectedId && (
        <DetailDialog
          id={selectedId}
          canEdit={rights.canEdit}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}

      {/* New Credit Note Dialog */}
      {creating && (
        <NewCreditNoteDialog
          onClose={() => setCreating(false)}
          onCreated={(nid) => {
            setCreating(false);
            reload();
            setTab("all");
            setSelectedId(nid);
          }}
        />
      )}
    </CrmShell>
  );
};

export default CrmCreditNotes;
