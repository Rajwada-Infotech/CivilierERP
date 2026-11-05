// Previews opened from a welcome call: an uploaded document, the Welcome Call PDF and an invoice PDF.
import React, { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileCheck, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOC_API, BKG_API, VC_API, KEY_INK, RULE, fmt, mimeIcon, fmtBytes } from "./config";

// ─── Preview dialog for a single uploaded document ──────────────────────────
export const DocPreviewDialog: React.FC<{ doc: any; onClose: () => void }> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    fetchWithAuth(`${DOC_API}/file/${doc.Id}`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            {mimeIcon(doc.MimeType)} {doc.FileName || doc.DocumentType}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/30 overflow-hidden">
          {!blobUrl ? (
            <span className="text-sm text-muted-foreground">Loading preview…</span>
          ) : doc.MimeType?.startsWith("image/") ? (
            <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[60vh] object-contain" />
          ) : doc.MimeType === "application/pdf" ? (
            <iframe src={blobUrl} title={doc.FileName} className="w-full h-[60vh] border-0" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
              {mimeIcon(doc.MimeType)}
              Preview not available for this file type.
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
          <span>{fmtBytes(doc.FileSize)}</span>
          {blobUrl && (
            <a href={blobUrl} download={doc.FileName} className="text-foreground hover:underline">Download</a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Real PDF preview for an invoice — same blob-fetch pattern as
// DocPreviewDialog above, pointed at the actual invoice PDF route
// (CrmBookingDetail.tsx's Payment & Invoice tab uses the identical
// component) instead of the old plain-text Type/Amount/Date summary.
export const WelcomeCallPdfDialog: React.FC<{ bookingId: number; bookingNo: string; onClose: () => void }> = ({ bookingId, bookingNo, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${VC_API}/${bookingId}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [bookingId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <DialogTitle className="font-heading flex items-center gap-1.5"><FileCheck size={16} className="text-foreground" /> Welcome Call Verification - {bookingNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`WelcomeCall_Verification_${bookingNo}.pdf`}
                className={`${KEY_INK} h-9 px-3 shrink-0`}>
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview...</span>
            : <iframe src={blobUrl} title={`WelcomeCall_${bookingNo}`} className="w-full h-[60vh] border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const InvoicePdfDialog: React.FC<{ bookingId: number; invoice: any; onClose: () => void }> = ({ bookingId, invoice, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${BKG_API}/${bookingId}/invoices/${invoice.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [bookingId, invoice.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="font-heading flex items-center gap-1.5"><FileCheck size={16} className="text-foreground" /> {invoice.InvoiceNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`}
                className={`${KEY_INK} h-9 px-3 shrink-0`}>
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          {invoice.InvoiceType} · {fmt(invoice.Amount)}
        </div>
      </DialogContent>
    </Dialog>
  );
};
