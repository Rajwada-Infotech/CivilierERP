// One agreement document opened for review: preview, its audit trail, and verify / reject.
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { KEY_INK, RULE } from "../customers/config";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Upload, File as FileIcon, Clock, UserCircle2, X, FolderClock, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PROXY_METHODS, type ProxyMethod, PROXY_METHOD_LABELS } from "@/components/crm/ProxyActionDialog";
import { API } from "./config";
import { docStatusColor } from "./Timeline";
import { mimeIcon, fmtBytes, fetchDocAudit } from "./forms";

export const DocumentReviewDialog: React.FC<{ agreementId: number; doc: any; onClose: () => void; onReviewed: () => void }> =
  ({ agreementId, doc, onClose, onReviewed }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [audit, setAudit] = useState<any[] | null>(null);
  const [remarks, setRemarks] = useState(doc.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const proxyAttachRef = useRef<HTMLInputElement>(null);
  const [proxyUploadOpen, setProxyUploadOpen] = useState(false);
  const [proxyUploadMethod, setProxyUploadMethod] = useState<ProxyMethod>("Phone");
  const [proxyUploadRemarks, setProxyUploadRemarks] = useState("");
  const [proxyUploadFile, setProxyUploadFile] = useState<File | null>(null);
  const [proxyUploading, setProxyUploading] = useState(false);

  const attachFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setAttaching(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/attach`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("File uploaded");
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAttaching(false);
    }
  };

  const handleProxyAttach = async () => {
    if (!proxyUploadFile || !proxyUploadRemarks.trim()) return;
    setProxyUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", proxyUploadFile);
      formData.append("ProxyMethod", proxyUploadMethod);
      formData.append("ProxyRemarks", proxyUploadRemarks.trim());
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/proxy-attach`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("Document submitted on customer's behalf");
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxyUploading(false);
    }
  };

  useEffect(() => {
    toast.dismiss();
  }, []);

  useEffect(() => {
    if (!doc.FilePath) return;
    let objectUrl: string | null = null;
    fetchWithAuth(`${API}/documents/file/${doc.Id}`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id, doc.FilePath]);

  useEffect(() => {
    if (tab === "history" && audit === null) fetchDocAudit(doc.Id).then(setAudit);
  }, [tab, audit, doc.Id]);

  const setStatus = async (status: string) => {
    if (status === CrmStatus.REJECTED && !remarks.trim()) { toast.error("Remarks are required to reject"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Remarks: remarks || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      toast.success(`Marked ${status}`);
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            {mimeIcon(doc.MimeType)} {doc.Label || doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}
            <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border font-medium ${docStatusColor[doc.Status] || ""}`}>{doc.Status}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border -mt-1">
          <button onClick={() => setTab("preview")}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 -mb-px ${tab === "preview" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Preview
          </button>
          <button onClick={() => setTab("history")}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 -mb-px flex items-center gap-1 ${tab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Clock size={12} /> History
          </button>
        </div>

        {tab === "preview" ? (
          <>
            <div className="flex items-center justify-center min-h-[240px] bg-muted/30 overflow-hidden">
              {!doc.FilePath && !doc.DocumentUrl ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
                  <Clock size={22} />
                  {doc.UploadedByType === "Customer" ? (
                    <p className="text-sm text-muted-foreground px-4 text-center">Awaiting upload from customer — nothing to preview yet.</p>
                  ) : (
                    <>
                      Not yet uploaded — Legal Executive to attach.
                      <input type="file" ref={attachInputRef} className="hidden"
                        onChange={(e) => attachFile(e.target.files)} />
                      <button type="button" onClick={() => attachInputRef.current?.click()} disabled={attaching}
                        className={`${KEY_INK} h-8 px-3`}>
                        <Upload size={12} /> {attaching ? "Uploading..." : "Upload File"}
                      </button>
                    </>
                  )}
                </div>
              ) : doc.DocumentUrl && !doc.FilePath ? (
                <a href={doc.DocumentUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2 py-8 text-primary text-sm hover:underline">
                  <FileIcon size={22} /> Open external document link
                </a>
              ) : !blobUrl ? (
                <span className="text-sm text-muted-foreground">Loading preview…</span>
              ) : doc.MimeType?.startsWith("image/") ? (
                <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[50vh] object-contain" />
              ) : doc.MimeType === "application/pdf" ? (
                <iframe src={blobUrl} title={doc.FileName} className="w-full h-[50vh] border-0" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">{mimeIcon(doc.MimeType)} Preview not available.</div>
              )}
            </div>

            {doc.UploadedByType === "Customer" && !doc.FilePath && !doc.DocumentUrl && (
              <div className="border border-border overflow-hidden">
                {!proxyUploadOpen ? (
                  <button type="button" onClick={() => setProxyUploadOpen(true)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors text-left">
                    <UserCircle2 size={13} className="shrink-0" />
                    Customer provided this document off-portal? Submit on their behalf
                  </button>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <UserCircle2 size={13} /> Submit on Customer's Behalf
                      </div>
                      <button type="button" onClick={() => setProxyUploadOpen(false)}
                        className="text-muted-foreground hover:text-foreground p-0.5">
                        <X size={14} />
                      </button>
                    </div>
                    <div>
                      <p className="text-[0.6875rem] text-muted-foreground mb-1.5">How did the customer provide this document?</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {PROXY_METHODS.map((m) => (
                          <button type="button" key={m} onClick={() => setProxyUploadMethod(m)}
                            className={`text-[0.6875rem] px-2 py-1.5 border font-medium transition-colors ${
                              proxyUploadMethod === m
                                ? "bg-foreground text-card border-foreground"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}>
                            {PROXY_METHOD_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      value={proxyUploadRemarks} onChange={(e) => setProxyUploadRemarks(e.target.value)}
                      placeholder="Brief note on how/when the document was received…"
                      rows={2}
                      className="w-full text-xs border border-border px-2.5 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input type="file" ref={proxyAttachRef} className="hidden"
                        onChange={(e) => setProxyUploadFile(e.target.files?.[0] || null)} />
                      <button type="button" onClick={() => proxyAttachRef.current?.click()}
                        className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-dashed border-border font-medium hover:bg-muted flex items-center gap-1.5 text-muted-foreground transition-colors">
                        <Upload size={11} className="shrink-0" />
                        <span className="truncate">{proxyUploadFile ? proxyUploadFile.name : "Choose File…"}</span>
                      </button>
                      <button type="button" onClick={handleProxyAttach}
                        disabled={proxyUploading || !proxyUploadFile || !proxyUploadRemarks.trim()}
                        className={`${KEY_INK} h-8 px-3`}>
                        {proxyUploading ? "Uploading…" : "Submit"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!!doc.FilePath && (
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>{doc.FileName} {doc.FileSize ? `· ${fmtBytes(doc.FileSize)}` : ""}{doc.IssuedBy ? ` · by ${doc.IssuedBy}` : ""}</span>
                {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline flex items-center gap-1"><Download size={12} /> Download</a>}
              </div>
            )}
            {!!doc.FilePath && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Remarks {doc.Status !== "Verified" ? "(required to reject)" : ""}</label>
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
                  placeholder="Reason for rejection, or any note for the record..."
                  className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
              </div>
            )}
          </>
        ) : (
          <div className="min-h-[240px] max-h-[50vh] overflow-y-auto">
            {audit === null ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading history…</div>
            ) : audit.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <FolderClock size={20} /> No review history yet for this document.
              </div>
            ) : (
              <ul className="space-y-2">
                {audit.map((h: any) => (
                  <li key={h.Id} className="text-xs border border-border px-3 py-2 flex items-start justify-between gap-3">
                    <div>
                      <span className="font-medium">{h.Field}</span>{": "}
                      <span className="text-muted-foreground">{h.OldValue || "—"}</span>{" → "}
                      <span className="font-medium">{h.NewValue || "—"}</span>
                    </div>
                    <div className="text-right text-muted-foreground shrink-0">
                      <div>{h.ChangedByName || "System"}</div>
                      <div>{fmtIstIso(h.ChangedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          {!!doc.FilePath && doc.Status !== "Verified" && (
            <button onClick={() => setStatus("Verified")} disabled={saving}
              className="px-3 py-1.5 text-xs bg-foreground text-card font-medium hover:bg-foreground/80 disabled:opacity-40">Verify</button>
          )}
          {!!doc.FilePath && doc.Status !== CrmStatus.REJECTED && (
            <button onClick={() => setStatus("Rejected")} disabled={saving}
              className="px-3 py-1.5 text-xs bg-destructive text-white font-medium hover:bg-destructive/80 disabled:opacity-40">Reject</button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
