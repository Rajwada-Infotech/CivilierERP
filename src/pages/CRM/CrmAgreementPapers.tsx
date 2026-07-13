import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Search, FileText, FileImage, FileSpreadsheet, File as FileIcon, Eye,
  Clock, XCircle, ArrowUpRight, Download,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// The Agreement Papers register — a cross-agreement, documents-only view
// scoped to the crm-documents permission (distinct from full crm-agreements
// CRUD rights, e.g. for a documents clerk who reviews submissions but
// shouldn't be able to edit agreement terms). The full per-agreement
// upload/request flow still lives on the Agreements page; this page is for
// scanning everything that needs review across every agreement at once,
// instead of opening each one individually.
const API = "/api/crm/agreements";

const STATUSES = ["Requested", "Submitted", "Uploaded", "Verified", "Rejected", "Pending"];
const DOC_TYPES = ["SaleAgreement", "AllotmentLetter", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];

const statusColor: Record<string, string> = {
  Requested: "text-amber-600 bg-amber-50 border-amber-200",
  Submitted: "text-blue-600 bg-blue-50 border-blue-200",
  Uploaded:  "text-blue-600 bg-blue-50 border-blue-200",
  Verified:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
};

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

async function fetchAllDocuments(status: string, documentType: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (documentType) params.set("documentType", documentType);
  const qs = params.toString();
  const r = await fetchWithAuth(`${API}/documents/all${qs ? `?${qs}` : ""}`);
  if (!r.ok) return [];
  return r.json();
}

function ReviewDialog({ doc, onClose, onReviewed }: { doc: any; onClose: () => void; onReviewed: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [remarks, setRemarks] = useState(doc.Remarks || "");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!doc.FilePath) return;
    let objectUrl: string | null = null;
    fetchWithAuth(`${API}/documents/file/${doc.Id}`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id, doc.FilePath]);

  const setStatus = async (status: string) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${doc.AgreementId}/documents/${doc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Remarks: remarks || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update");
      toast.success(`Marked ${status}`);
      onReviewed();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            {mimeIcon(doc.MimeType)} {doc.Label || doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}
          </DialogTitle>
          <DialogDescription>
            {doc.AgreementNo} · {doc.ApplicantName} · {doc.BookingNo}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center min-h-[240px] bg-muted/30 rounded-lg overflow-hidden">
          {!doc.FilePath ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
              <Clock size={22} /> Awaiting upload from customer — nothing to preview yet.
            </div>
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

        {doc.FilePath && (
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{doc.FileName} {doc.FileSize ? `· ${fmtBytes(doc.FileSize)}` : ""}</span>
            {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline flex items-center gap-1"><Download size={12} /> Download</a>}
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Remarks {doc.Status !== "Verified" ? "(required to reject)" : ""}</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
            placeholder="Reason for rejection, or any note for the record..."
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <button onClick={() => navigate(`/crm/agreements?id=${doc.AgreementId}`)}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            Open in Agreements <ArrowUpRight size={12} />
          </button>
          <div className="flex gap-2">
            {doc.FilePath && doc.Status !== "Verified" && (
              <button onClick={() => setStatus("Verified")} disabled={saving}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40">Verify</button>
            )}
            {doc.FilePath && doc.Status !== "Rejected" && (
              <button onClick={() => { if (!remarks.trim()) { toast.error("Remarks are required to reject"); return; } setStatus("Rejected"); }}
                disabled={saving} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">Reject</button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmAgreementPapers: React.FC = () => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [reviewDoc, setReviewDoc] = useState<any | null>(null);

  const { data: documents = [], isLoading, refetch } = useQuery({
    queryKey: ["crm-agreement-papers", status, documentType],
    queryFn: () => fetchAllDocuments(status, documentType),
    staleTime: 30_000,
  });

  const filtered = (documents as any[]).filter((d) =>
    !search || d.ApplicantName?.toLowerCase().includes(search.toLowerCase())
      || d.AgreementNo?.toLowerCase().includes(search.toLowerCase())
      || d.BookingNo?.toLowerCase().includes(search.toLowerCase())
  );

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = (documents as any[]).filter((d) => d.Status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <SalesAutoShell title="CRM — Agreement Papers" subtitle="Every agreement document, across every booking, in one register">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applicant, agreement no, booking no..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="text-sm border border-border rounded-lg px-2 py-2 bg-background">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s} {counts[s] ? `(${counts[s]})` : ""}</option>)}
          </select>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}
            className="text-sm border border-border rounded-lg px-2 py-2 bg-background">
            <option value="">All Document Types</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/([A-Z])/g, " $1").trim()}</option>)}
          </select>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No documents match this filter</div>
          ) : filtered.map((d: any) => {
            const awaiting = d.Status === "Requested" && !d.FilePath;
            return (
              <button key={d.Id} onClick={() => setReviewDoc(d)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/20 text-left">
                <div className="flex items-center gap-3 min-w-0">
                  {awaiting ? <Clock size={16} className="text-amber-500 shrink-0" />
                    : d.Status === "Rejected" ? <XCircle size={16} className="text-red-500 shrink-0" />
                    : mimeIcon(d.MimeType)}
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                      {d.IsMandatory ? <span className="text-red-500">*</span> : null}
                      {d.UploadedByType === "Customer" && <span className="text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded-full px-1.5 font-normal">customer</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-md">
                      {d.AgreementNo} · {d.ApplicantName} · {d.BookingNo} · {d.UnitNo}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">{fmtDate(d.UploadedAt || d.RequestedAt || d.CreatedAt)}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusColor[d.Status] || ""}`}>{d.Status}</span>
                  <Eye size={13} className="text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {reviewDoc && (
        <ReviewDialog
          doc={reviewDoc}
          onClose={() => setReviewDoc(null)}
          onReviewed={() => { setReviewDoc(null); refetch(); }}
        />
      )}
    </SalesAutoShell>
  );
};

export default CrmAgreementPapers;
