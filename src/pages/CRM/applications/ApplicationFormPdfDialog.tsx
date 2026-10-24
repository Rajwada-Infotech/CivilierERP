// The Application Form PDF, previewed in a frame with a Download.
import React, { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API, RULE } from "./config";

// Same "fetch as blob, preview in an iframe, offer Download" pattern as
// CrmMoneyReceipts.tsx's ReceiptPdfDialog — so staff can hand a customer
// both documents the same way, from the same page.
export const ApplicationFormPdfDialog: React.FC<{ applicationId: number; applicationNo: string; onClose: () => void }> = ({ applicationId, applicationNo, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${applicationId}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [applicationId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2"><FileText size={16} className="text-primary" /> Application Form — {applicationNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${applicationNo}-ApplicationForm.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground font-medium hover:bg-primary/90 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[400px] bg-muted/20 overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Generating preview…</span>
            : <iframe src={blobUrl} title={applicationNo} className="w-full h-[75vh] border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
};
