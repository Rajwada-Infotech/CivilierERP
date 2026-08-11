import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, Download, Search, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/invoices";

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

const TYPES = ["Booking", "Milestone", "Maintenance", "Other", "OnAccount", "Agreement", "Possession"];

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

function InvoicePreviewDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`/api/crm/bookings/${invoice.BookingId}/invoices/${invoice.Id}/pdf`)
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

const CrmInvoices: React.FC = () => {
  const [type, setType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<InvoiceRow | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["crm-invoices", type, search],
    queryFn: () => fetchInvoices(type, search),
    placeholderData: (prev) => prev,
  });

  const filtered = useMemo(() => rows, [rows]);

  const columns: ColumnDef<InvoiceRow, unknown>[] = [
    { accessorKey: "InvoiceNo", header: "Invoice No.", size: 130,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.row.original.InvoiceNo}</span> },
    { accessorKey: "InvoiceType", header: "Type", size: 100,
      cell: (i) => <span className="text-xs px-2 py-0.5 rounded-md bg-muted font-medium">{i.row.original.InvoiceType}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.row.original.BookingNo}</span> },
    { id: "applicant", header: "Applicant", size: 150, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="font-medium text-sm">{i.row.original.ApplicantName}</div>
          {i.row.original.Mobile && <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>}
        </div>
      ) },
    { accessorKey: "Amount", header: "Amount", size: 100, cell: (i) => <span className="font-semibold text-sm">{fmtMoney(i.row.original.Amount)}</span> },
    { accessorKey: "InvoiceDate", header: "Date", size: 100, cell: (i) => <span className="text-sm">{fmtDate(i.row.original.InvoiceDate)}</span> },
    { accessorKey: "CreatedByName", header: "Generated By", size: 120, cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CreatedByName || "—"}</span> },
    { id: "action", header: "Action", size: 160, enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPreview(i.row.original)}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
            <FileText className="w-3 h-3" /> PDF
          </button>
          <a href={`/crm/bookings?view=${i.row.original.BookingId}`}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-muted">
            <ExternalLink className="w-3 h-3" /> Booking
          </a>
        </div>
      ) },
  ];

  return (
    <SalesAutoShell
      title="CRM — Invoices"
      subtitle="Every invoice across every booking — generation itself is manual-only, gated on the milestone's Demand, from the Booking's own Payment & Invoice tab"
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
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No invoices generated yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {preview && <InvoicePreviewDialog invoice={preview} onClose={() => setPreview(null)} />}
    </SalesAutoShell>
  );
};

export default CrmInvoices;
