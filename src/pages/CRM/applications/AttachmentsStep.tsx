// Wizard step: documents.
import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Upload, Trash2, FileText, X, Eye, Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { BodyPortal } from "@/components/ui/body-portal";
import { DOC_API, DOC_TYPES, inputCls } from "./config";

// ── Step 5: Attachments — document upload only ─────────────────────────────────
export const AttachmentsStep: React.FC<{
  applicationId: number;
}> = ({ applicationId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!previewDoc) {
      setPreviewBlobUrl(null);
      setPreviewError(null);
      return;
    }

    let alive = true;
    let objectUrl: string | null = null;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewBlobUrl(null);

    fetchWithAuth(`${DOC_API}/file/${previewDoc.Id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Preview unavailable");
        return res.blob();
      })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
      })
      .catch((e: any) => {
        if (alive) setPreviewError(e.message || "Preview unavailable");
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc]);

  const { data: docData, refetch: refetchDocs } = useQuery({
    queryKey: ["crm-app-documents", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${DOC_API}/application/${applicationId}`);
      return r.ok ? r.json() : { documents: [] };
    },
  });

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!docType) { toast.error("Select a document type before uploading"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docType);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${DOC_API}/application/${applicationId}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocType("");
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${DOC_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <div className="space-y-4">
      <div className=" border border-border p-3 space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><FileText size={13} /> Documents</label>
        <div className="flex gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${inputCls} flex-1`}>
            <option value="">Select document type</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || !docType}
            className="px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
            <Upload size={12} /> {uploading ? "Uploading..." : "Upload"}
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
        </div>
        <div className="space-y-1">
          {(docData?.documents || []).map((d: any) => {
            const fileUrl = `${DOC_API}/file/${d.Id}`;
            const previewable = /\.(jpe?g|png|gif|webp|bmp|svg|pdf)$/i.test(d.FileName || "");
            

  return (
              <div key={d.Id} className="flex items-center justify-between gap-2 text-xs bg-muted/30 px-2.5 py-1.5">
                <span className="truncate flex-1">{d.DocumentType} — {d.FileName}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {previewable && (
                    <button data-row-view type="button" title="Preview" onClick={() => setPreviewDoc(d)}
                      className="text-muted-foreground hover:text-primary flex items-center gap-0.5">
                      <Eye size={12} />
                    </button>
                  )}
                  <a href={fileUrl} download={d.FileName}
                    className="text-muted-foreground hover:text-primary flex items-center gap-0.5">
                    <Download size={12} />
                  </a>
                  <button onClick={() => handleRemoveDoc(d.Id)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                </div>
              </div>
            );
          })}
          {(!docData?.documents || docData.documents.length === 0) && (
            <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
          )}
        </div>
      </div>
      {/* Plain div overlay — avoids nested Radix Dialog focus-trap conflict
          (this preview opens while the parent wizard Dialog is still open). */}
      {previewDoc && (
        <BodyPortal><div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewDoc(null)}>
          <div className="bg-background border border-border shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FileText size={15} className="text-primary shrink-0" />
                <span className="truncate">{previewDoc.DocumentType} — {previewDoc.FileName}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <a href={previewBlobUrl || "#"} download={previewDoc.FileName}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border font-medium ${!previewBlobUrl ? "opacity-50 pointer-events-none" : "hover:bg-muted"}`}>
                  <Download size={13} /> {previewBlobUrl ? "Download" : "Loading..."}
                </a>
                <button onClick={() => setPreviewDoc(null)} className="p-1 hover:bg-muted text-muted-foreground"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 h-[76vh] bg-neutral-950 flex items-center justify-center">
              {previewLoading ? (
                <div className="text-xs text-neutral-300">Loading preview...</div>
              ) : previewError ? (
                <div className="text-center space-y-2 px-4">
                  <p className="text-sm text-neutral-100">{previewError}</p>
                  <a href={previewBlobUrl || `${DOC_API}/file/${previewDoc.Id}`} download={previewDoc.FileName}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <Download size={13} /> Download file
                  </a>
                </div>
              ) : !previewBlobUrl ? null : /\.pdf$/i.test(previewDoc.FileName || "") ? (
                <iframe src={previewBlobUrl} title={previewDoc.FileName} className="w-full h-full border-0 bg-white" />
              ) : (
                <img src={previewBlobUrl} alt={previewDoc.FileName} className="max-w-full max-h-full object-contain" />
              )}
            </div>
          </div>
        </div></BodyPortal>
      )}
    </div>
  );
};
