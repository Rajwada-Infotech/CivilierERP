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
import { FileText, Download, CheckCircle2, Clock, AlertTriangle, Search, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/money-receipts";

interface ReceiptRow {
  Id: number;
  ReceiptNo: string;
  BookingId: number;
  ReceivedPaymentId: number;
  Amount: number;
  BaseAmount: number | null;
  GSTAmount: number | null;
  PaymentMode: string;
  ChequeNo: string | null;
  ReceivedDate: string;
  Status: typeof CrmStatus.PENDING | typeof CrmStatus.APPROVED | "Bounced";
  BouncedReason: string | null;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedAt: string;
}

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN");
}

async function fetchReceipts(bookingId?: string): Promise<ReceiptRow[]> {
  const q = new URLSearchParams();
  if (bookingId) q.set("bookingId", bookingId);
  const res = await fetchWithAuth(`${API}?${q}`);
  if (!res.ok) throw new Error("Failed to load money receipts");
  return res.json();
}

function StatusPill({ status }: { status: ReceiptRow["Status"] }) {
  if (status === CrmStatus.APPROVED)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"><CheckCircle2 className="w-3 h-3" /> Approved</span>;
  if (status === "Bounced")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"><AlertTriangle className="w-3 h-3" /> Bounced</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"><Clock className="w-3 h-3" /> Pending Approval</span>;
}

function ReceiptPdfDialog({ receipt, onClose }: { receipt: ReceiptRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${receipt.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2"><FileText size={16} className="text-primary" /> {receipt.ReceiptNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${receipt.ReceiptNo}.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 rounded-lg overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={receipt.ReceiptNo} className="w-full h-[60vh] border-0" />}
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          {receipt.BookingNo} · {fmtMoney(receipt.Amount)} · <StatusPill status={receipt.Status} />
        </div>
        {receipt.Status === "Bounced" && receipt.BouncedReason && (
          <p className="text-[11px] text-red-600 dark:text-red-400">Bounce reason: {receipt.BouncedReason}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

const CrmMoneyReceipts: React.FC = () => {
  const [searchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || undefined;

  const [search, setSearch] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptRow | null>(null);
  const qc = useQueryClient();

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-money-receipts", bookingIdParam],
    queryFn: () => fetchReceipts(bookingIdParam),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      r.ReceiptNo.toLowerCase().includes(q) || r.BookingNo.toLowerCase().includes(q) || r.ApplicantName?.toLowerCase().includes(q));
  }, [rows, search]);

  async function handleResubmit(row: ReceiptRow) {
    try {
      const res = await fetchWithAuth(`${API}/${row.Id}/resubmit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Resubmit failed" }));
        toast.error(err.error || "Resubmit failed");
        return;
      }
      toast.success(`${row.ReceiptNo} resubmitted for approval`);
      qc.invalidateQueries({ queryKey: ["crm-money-receipts"] });
    } catch {
      toast.error("Network error — could not resubmit receipt");
    }
  }

  const columns: ColumnDef<ReceiptRow, unknown>[] = [
    { accessorKey: "ReceiptNo", header: "Receipt No.", size: 130,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.row.original.ReceiptNo}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 110,
      cell: (i) => <span className="font-mono text-xs">{i.row.original.BookingNo}</span> },
    { id: "applicant", header: "Applicant", size: 150, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="font-medium text-sm">{i.row.original.ApplicantName}</div>
          {i.row.original.Mobile && <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>}
        </div>
      ) },
    { accessorKey: "Amount", header: "Amount", size: 130, cell: (i) => {
        const r = i.row.original;
        return (
          <div>
            <div className="font-semibold text-sm">{fmtMoney(r.Amount)}</div>
            {r.BaseAmount != null && r.GSTAmount != null && (
              <div className="text-[11px] text-muted-foreground font-mono">
                Base {fmtMoney(r.BaseAmount)} + GST {fmtMoney(r.GSTAmount)}
              </div>
            )}
          </div>
        );
      } },
    { accessorKey: "PaymentMode", header: "Mode", size: 90,
      cell: (i) => (
        <div>
          <div className="text-sm">{i.row.original.PaymentMode}</div>
          {i.row.original.ChequeNo && <div className="text-xs text-muted-foreground font-mono">{i.row.original.ChequeNo}</div>}
        </div>
      ) },
    { accessorKey: "ReceivedDate", header: "Received", size: 100, cell: (i) => <span className="text-sm">{fmtDate(i.row.original.ReceivedDate)}</span> },
    { accessorKey: "Status", header: "Status", size: 130, cell: (i) => <StatusPill status={i.row.original.Status} /> },
    { id: "action", header: "Action", size: 190, enableSorting: false,
      cell: (i) => {
        const row = i.row.original;
        return (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPreviewReceipt(row)}
              className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
              <FileText className="w-3 h-3" /> PDF
            </button>
            {row.Status === "Bounced" && !row.ReceivedPaymentId && (
              <button onClick={() => handleResubmit(row)}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
                <RotateCcw className="w-3 h-3" /> Resubmit
              </button>
            )}
          </div>
        );
      } },
  ];

  usePageRights("crm-money-receipts");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Money Receipts"]} />
      <CrmShell
        title="CRM — Money Receipts"
      subtitle="Created once Data Review is complete and the Booking has been submitted for approval — one receipt per Booking Amount"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt no, booking, applicant..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No money receipts yet — one becomes available once a Booking's Data Review checklist is complete and it's been submitted for approval."
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {previewReceipt && <ReceiptPdfDialog receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} />}
    </CrmShell>
    </>
  );
};

export default CrmMoneyReceipts;
