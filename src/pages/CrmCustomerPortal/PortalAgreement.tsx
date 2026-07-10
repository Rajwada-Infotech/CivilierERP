import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, FileImage, FileSpreadsheet, File as FileIcon, CheckCircle2,
  Eye, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API, authHeaders, fetchAgreement, fetchAgreementDocuments, fmtMoney, fmtDate, fmtBytes } from "./portalApi";

type Ctx = { me: any; timeline: any };

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-slate-400 shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-slate-400 shrink-0" />;
}

function DocPreviewDialog({ doc, onClose }: { doc: any; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    fetch(`${API}/agreement/documents/file/${doc.Id}`, { headers: authHeaders() })
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{mimeIcon(doc.MimeType)} {doc.FileName || doc.DocumentType}</DialogTitle></DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-slate-50 rounded-lg overflow-hidden">
          {!blobUrl ? <span className="text-sm text-slate-400">Loading preview…</span>
            : doc.MimeType?.startsWith("image/") ? <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[60vh] object-contain" />
            : doc.MimeType === "application/pdf" ? <iframe src={blobUrl} title={doc.FileName} className="w-full h-[60vh] border-0" />
            : <div className="flex flex-col items-center gap-2 py-8 text-slate-400 text-sm">{mimeIcon(doc.MimeType)} Preview not available for this file type.</div>}
        </div>
        <div className="flex justify-between items-center text-xs text-slate-400 pt-1">
          <span>{fmtBytes(doc.FileSize)}</span>
          {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-violet-600 hover:underline">Download</a>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RespondDialog({
  title, onClose, onSubmit,
}: { title: string; onClose: () => void; onSubmit: (decision: "Approve" | "Recheck", remarks: string) => void }) {
  const [mode, setMode] = useState<"choose" | "recheck">("choose");
  const [remarks, setRemarks] = useState("");

  if (mode === "recheck") {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request a Recheck</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">Please describe what needs to be corrected — this goes straight to our team.</p>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4}
            placeholder="e.g. My name is spelled incorrectly, the unit area is wrong..."
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none" />
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setMode("choose")} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">Back</button>
            <button onClick={() => { if (!remarks.trim()) { toast.error("Remarks are required"); return; } onSubmit("Recheck", remarks); }}
              className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700">Submit Recheck Request</button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">Please review all details and documents carefully before approving.</p>
        <div className="grid grid-cols-1 gap-2 pt-1">
          <button onClick={() => onSubmit("Approve", "")}
            className="px-4 py-2.5 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 text-left">
            Approve
            <span className="block text-[11px] font-normal opacity-80">Everything looks correct</span>
          </button>
          <button onClick={() => setMode("recheck")}
            className="px-4 py-2.5 text-sm border border-slate-200 rounded-lg font-medium hover:bg-slate-50 text-left">
            Request a Recheck
            <span className="block text-[11px] font-normal text-slate-500">Something needs to be corrected</span>
          </button>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PortalAgreement: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [respondFor, setRespondFor] = useState<"agreement" | "salesDeed" | null>(null);

  const { data: agreement } = useQuery({ queryKey: ["portal-agreement"], queryFn: fetchAgreement });
  const { data: documents = [] } = useQuery({ queryKey: ["portal-agreement-documents"], queryFn: fetchAgreementDocuments });

  const respond = async (endpoint: string, decision: "Approve" | "Recheck", remarks: string) => {
    try {
      const res = await fetch(`${API}${endpoint}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ decision, remarks }) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(decision === "Approve" ? "Approved — thank you!" : "Recheck requested");
      setRespondFor(null);
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
      qc.invalidateQueries({ queryKey: ["portal-agreement"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!agreement && !timeline.salesDeed) {
    return (
      <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-slate-500">
        Your agreement isn't ready yet. We'll notify you the moment it's shared for your review.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">Agreement</h1>
        <p className="text-sm text-slate-500 mt-0.5">Review your agreement terms, documents, and give your approval.</p>
      </div>

      {agreement && (
        <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">{agreement.AgreementNo}</h2>
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              agreement.CustomerApprovalStatus === "Approved" ? "bg-emerald-100 text-emerald-700"
              : agreement.CustomerApprovalStatus === "RecheckRequested" ? "bg-rose-100 text-rose-700"
              : "bg-amber-100 text-amber-700"
            }`}>{agreement.CustomerApprovalStatus}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div><p className="text-[11px] text-slate-400">Legal Name</p><p className="font-medium text-slate-800 mt-0.5">{agreement.LegalName || "—"}</p></div>
            <div><p className="text-[11px] text-slate-400">Unit</p><p className="font-medium text-slate-800 mt-0.5">{agreement.UnitNo}</p></div>
            <div><p className="text-[11px] text-slate-400">Total Value</p><p className="font-medium text-slate-800 mt-0.5">{fmtMoney(agreement.TotalValue)}</p></div>
            <div><p className="text-[11px] text-slate-400">Proposed Date</p><p className="font-medium text-slate-800 mt-0.5">{fmtDate(agreement.ProposedDateByCompany)}</p></div>
            <div><p className="text-[11px] text-slate-400">Agreement Date</p><p className="font-medium text-slate-800 mt-0.5">{fmtDate(agreement.AgreementDate)}</p></div>
            <div><p className="text-[11px] text-slate-400">Documents</p><p className="font-medium text-slate-800 mt-0.5">{documents.length}</p></div>
          </div>
          {agreement.LastRecheckRemarks && (
            <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Your last recheck note: {agreement.LastRecheckRemarks}
            </div>
          )}
          {agreement.CustomerApprovalStatus === "Pending" ? (
            <button onClick={() => setRespondFor("agreement")}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700">
              Review & Respond
            </button>
          ) : agreement.CustomerApprovalStatus === "Approved" ? (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium"><CheckCircle2 size={16} /> You've approved this agreement</div>
          ) : null}
        </div>
      )}

      {/* Documents */}
      {documents.length > 0 && (
        <div className="rounded-2xl border border-violet-100 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-violet-50">
            <h2 className="text-sm font-bold text-slate-800">Documents ({documents.length})</h2>
          </div>
          {documents.map((d: any) => (
            <button key={d.Id} onClick={() => setPreviewDoc(d)}
              className="w-full flex items-center justify-between gap-3 px-5 py-3 border-b border-violet-50 last:border-0 hover:bg-violet-50/40 text-left">
              <div className="flex items-center gap-3 min-w-0">
                {mimeIcon(d.MimeType)}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{d.DocumentType.replace(/([A-Z])/g, " $1").trim()}{d.VersionNo > 1 ? ` (v${d.VersionNo})` : ""}</p>
                  <p className="text-[11px] text-slate-400 truncate">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</p>
                </div>
              </div>
              <Eye size={14} className="text-slate-300 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Sales Deed */}
      {timeline.salesDeed?.SentToCustomerAt && (
        <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">Sales Deed</h2>
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              timeline.salesDeed.CustomerApprovalStatus === "Approved" ? "bg-emerald-100 text-emerald-700"
              : timeline.salesDeed.CustomerApprovalStatus === "RecheckRequested" ? "bg-rose-100 text-rose-700"
              : "bg-amber-100 text-amber-700"
            }`}>{timeline.salesDeed.CustomerApprovalStatus}</span>
          </div>
          <div className="text-sm"><span className="text-[11px] text-slate-400">Status: </span>{timeline.salesDeed.Status}</div>
          {timeline.salesDeed.CustomerApprovalStatus === "Pending" ? (
            <button onClick={() => setRespondFor("salesDeed")}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700">
              Review & Respond
            </button>
          ) : timeline.salesDeed.CustomerApprovalStatus === "Approved" ? (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium"><CheckCircle2 size={16} /> You've approved this sales deed</div>
          ) : null}
        </div>
      )}

      {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
      {respondFor && (
        <RespondDialog
          title={respondFor === "agreement" ? "Respond to Agreement" : "Respond to Sales Deed"}
          onClose={() => setRespondFor(null)}
          onSubmit={(decision, remarks) => respond(respondFor === "agreement" ? "/agreement/respond" : "/sales-deed/respond", decision, remarks)}
        />
      )}
    </div>
  );
};

export default PortalAgreement;
