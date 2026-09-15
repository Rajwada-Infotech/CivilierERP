import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Upload, FileText, Trash2, Download, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getEmployeeDocuments,
  uploadEmployeeDocument,
  deleteEmployeeDocument,
  employeeDocumentUrl,
  type EmployeeDocument,
} from "@/api/employeeMasterApi";

// The 8 document types requested for Employee Master.
export const EMPLOYEE_DOC_TYPES = [
  "Aadhaar",
  "PAN",
  "Resume",
  "Appointment Letter",
  "Joining Documents",
  "Bank Proof",
  "Certificates",
  "Experience Letter",
] as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Attachments are behind JWT auth, so a plain anchor navigation does not
// carry the Authorization header -- fetch as an authenticated blob and
// open or save that instead. Mirrors TaskDrawer.tsx openAttachment.
async function openDocument(attachmentId: number, fileName: string) {
  try {
    const res = await fetchWithAuth(employeeDocumentUrl(attachmentId));
    if (!res.ok) throw new Error("Failed to load document");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    toast.error("Failed to open document");
  }
}

export const EmployeeDocumentsModal: React.FC<{
  employeeId: number;
  employeeName: string;
  onClose: () => void;
}> = ({ employeeId, employeeName, onClose }) => {
  const rights = usePageRights("employee-master");
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState<string>(EMPLOYEE_DOC_TYPES[0]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refetch = () => {
    setLoading(true);
    getEmployeeDocuments(employeeId)
      .then(setDocs)
      .catch(() => toast.error("Failed to load documents"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadEmployeeDocument(employeeId, file, docType);
      toast.success(docType + " uploaded");
      refetch();
    } catch (err: any) {
      toast.error(err && err.message ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (attachmentId: number) => {
    if (!window.confirm("Remove this document?")) return;
    try {
      await deleteEmployeeDocument(attachmentId);
      toast.success("Document removed");
      setDocs((prev) => prev.filter((d) => d.AttachmentId !== attachmentId));
    } catch (err: any) {
      toast.error(err && err.message ? err.message : "Delete failed");
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 bw-modal-topmost"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-heading font-semibold text-foreground flex items-center gap-2">
              <FileText size={15} /> Documents
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{employeeName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {rights.canEdit && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-9 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {EMPLOYEE_DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 h-9 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {uploading ? "Uploading..." : "Upload"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFilePicked(e.target.files?.[0])}
              />
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
          ) : docs.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No documents uploaded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <div
                  key={d.AttachmentId}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{d.FileName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {d.DocType} - {formatSize(d.FileSize)}
                      {d.UploadedAt ? " - " + new Date(d.UploadedAt).toLocaleDateString("en-IN") : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDocument(d.AttachmentId, d.FileName)}
                    className="p-1.5 rounded text-primary hover:bg-primary/10 transition-colors shrink-0"
                    title="View or download"
                  >
                    <Download size={14} />
                  </button>
                  {rights.canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(d.AttachmentId)}
                      className="p-1.5 rounded text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
