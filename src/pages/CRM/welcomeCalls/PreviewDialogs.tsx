// Previews opened from a welcome call: an uploaded document, the Welcome Call PDF and an invoice PDF.
import React, { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileCheck, Download, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOC_API, BKG_API, VC_API, KEY_INK, KEY_LINE, fmt, mimeIcon, fmtBytes } from "./config";

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
      <DialogContent className="max-w-3xl rounded-xl p-5 gap-4">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold truncate">
              {mimeIcon(doc.MimeType)} <span className="truncate">{doc.FileName || doc.DocumentType}</span>
            </DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={doc.FileName} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
                <Download size={13} /> Download
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[320px] rounded-lg border border-border bg-muted/20 overflow-hidden">
          {!blobUrl ? (
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading preview…
            </span>
          ) : doc.MimeType?.startsWith("image/") ? (
            <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[62vh] object-contain" />
          ) : doc.MimeType === "application/pdf" ? (
            <iframe src={blobUrl} title={doc.FileName} className="w-full h-[62vh] border-0" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
              {mimeIcon(doc.MimeType)}
              Preview not available for this file type.
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span>{doc.DocumentType}{doc.FileSize ? ` · ${fmtBytes(doc.FileSize)}` : ""}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Real PDF preview for the Welcome Call Verification dossier
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
      <DialogContent className="max-w-3xl rounded-xl p-5 gap-4">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <FileCheck size={16} className="text-primary shrink-0" /> Welcome Call Verification · {bookingNo}
            </DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`WelcomeCall_Verification_${bookingNo}.pdf`}
                className={`${KEY_INK} h-8 px-3 shrink-0`}>
                <Download size={13} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[340px] rounded-lg border border-border bg-muted/20 overflow-hidden">
          {!blobUrl ? (
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading preview…
            </span>
          ) : (
            <iframe src={blobUrl} title={`WelcomeCall_${bookingNo}`} className="w-full h-[65vh] border-0" />
          )}
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
      <DialogContent className="max-w-3xl rounded-xl p-5 gap-4">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <FileCheck size={16} className="text-primary shrink-0" /> {invoice.InvoiceNo}
            </DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`}
                className={`${KEY_INK} h-8 px-3 shrink-0`}>
                <Download size={13} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[340px] rounded-lg border border-border bg-muted/20 overflow-hidden">
          {!blobUrl ? (
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading preview…
            </span>
          ) : (
            <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[65vh] border-0" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {invoice.InvoiceType} · {fmt(invoice.Amount)}
        </div>
      </DialogContent>
    </Dialog>
  );
};
