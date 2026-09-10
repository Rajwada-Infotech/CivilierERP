// Shared read-only invoice table + PDF preview, used by both the Booking
// Detail page (Payment & Invoice tab) and the Applications page detail
// dialog so a booking's invoices render identically everywhere. Invoices
// are never generated here — creation lives exclusively on the CRM
// Invoices page, after each milestone's Demand is raised.
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Eye, Download, X, AlertTriangle, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const fmt = (n: number | null | undefined) =>
  n == null || isNaN(Number(n)) ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

const SORT_COLS: { key: string; label: string }[] = [
  { key: "InvoiceNo", label: "Invoice No" },
  { key: "InvoiceType", label: "Type" },
  { key: "Amount", label: "Amount" },
  { key: "InvoiceDate", label: "Date" },
  { key: "Status", label: "Status" },
  { key: "CreatedByName", label: "By" },
];

function InvoicePdfDialog({ pdfUrl, title, subtitle, filename, onClose }: {
  pdfUrl: string; title: string; subtitle?: string; filename: string; onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoadError(null);
    setBlobUrl(null);
    fetchWithAuth(pdfUrl)
      .then((r) => { if (!r.ok) throw new Error(`Failed to load PDF (${r.status})`); return r.blob(); })
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch((e) => { if (!cancelled) setLoadError(e?.message || "Failed to load PDF"); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [pdfUrl]);

  return createPortal(
    <div data-overlay-portal className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      style={{ pointerEvents: "auto" }}
      onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-primary shrink-0" />
              <span className="font-medium text-sm truncate">{title}</span>
            </div>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {blobUrl && (
              <a href={blobUrl} download={filename}
                className="px-3 py-1.5 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
            <button onClick={onClose} className="p-1 rounded-md hover:bg-muted text-muted-foreground"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[300px] bg-muted/20 overflow-hidden">
          {loadError
            ? <span className="text-sm text-destructive flex items-center gap-2"><AlertTriangle size={14} /> {loadError}</span>
            : !blobUrl
              ? <span className="text-sm text-muted-foreground flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading preview…</span>
              : <iframe src={blobUrl} title={title} className="w-full h-[65vh] border-0" />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CrmInvoiceList({ invoices, emptyText = "No invoices generated yet." }: {
  invoices: any[];
  emptyText?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const rows = useMemo(() => {
    const r = (invoices || []).slice();
    if (!sort) return r;
    const { key, dir } = sort;
    r.sort((a, b) => {
      let av = a?.[key];
      let bv = b?.[key];
      if (key === "Amount") { av = Number(av) || 0; bv = Number(bv) || 0; }
      else if (key === "InvoiceDate") { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
      else { av = (av ?? "").toString().toLowerCase(); bv = (bv ?? "").toString().toLowerCase(); }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return r;
  }, [invoices, sort]);

  if (!rows.length) {
    return <p className="text-xs text-muted-foreground py-4">{emptyText}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto thin-scroll">
        <div className="min-w-[700px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {SORT_COLS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap">
                    <span className="flex items-center gap-0.5">
                      {c.label}
                      {sort?.key === c.key && (sort.dir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                    </span>
                  </th>
                ))}
                <th className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium whitespace-nowrap">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv: any) => (
                <tr key={inv.Id} className="border-b border-border hover:bg-muted/30">
                  <td className="px-2.5 py-2 whitespace-nowrap">{inv.InvoiceNo}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{inv.InvoiceType}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap font-medium">{fmt(inv.Amount)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-xs text-muted-foreground">{inv.InvoiceDate ? new Date(inv.InvoiceDate).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{inv.Status || "Active"}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-xs">{inv.CreatedByName || "—"}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <button onClick={() => setPreview(inv)}
                      className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
                      <Eye size={12} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {preview && (
        <InvoicePdfDialog
          pdfUrl={`/api/crm/bookings/${preview.BookingId}/invoices/${preview.Id}/pdf`}
          title={preview.InvoiceNo}
          subtitle={`${preview.InvoiceType} · ${fmt(preview.Amount)}`}
          filename={`${preview.InvoiceNo}.pdf`}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

export default CrmInvoiceList;
