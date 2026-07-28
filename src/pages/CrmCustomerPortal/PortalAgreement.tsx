import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, FileImage, FileSpreadsheet, File as FileIcon, CheckCircle2,
  Eye, AlertTriangle, CalendarCheck2, Landmark, Download, Hash, ScrollText,
  UploadCloud, Clock, XCircle,
} from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { API, authHeaders, fetchAgreement, fetchAgreementDocuments, uploadAgreementDoc, proposeAgreementDate, respondAgreement, respondSalesDeed, fmtMoney, fmtDate, fmtBytes, maskAadhaar } from "./portalApi";
import {
  PageHeader, Card, CardHeader, InfoField, StatusPill, Stepper, StepState,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
  GOLD, GOLD_SOFT, INK, VIOLET, HAIRLINE, SURFACE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT, serif, mono,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

function mimeIcon(mime: string | null | undefined, size = 16) {
  if (!mime) return <FileIcon size={size} className="text-slate-400 shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={size} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={size} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={size} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={size} className="text-slate-400 shrink-0" />;
}

function agreementSteps(ag: any): { label: string; state: StepState; note?: string }[] {
  const senior = !!ag?.SeniorApprovedAt;
  const sent = !!ag?.SentToCustomerAt;
  const status = ag?.CustomerApprovalStatus;
  const dated = !!ag?.AgreementDate;
  return [
    { label: "Prepared", state: "done", note: fmtDate(ag?.CreatedAt) },
    { label: "Approved In-House", state: senior ? "done" : "current", note: senior ? fmtDate(ag?.SeniorApprovedAt) : "Pending" },
    { label: "Shared with You", state: sent ? "done" : senior ? "current" : "upcoming", note: sent ? fmtDate(ag?.SentToCustomerAt) : undefined },
    {
      label: "Your Review",
      state: !sent ? "upcoming" : status === "Approved" ? "done" : status === "Recheck" ? "blocked" : "current",
      note: !sent ? undefined : status === "Approved" ? fmtDate(ag?.CustomerApprovedAt) : status === "Recheck" ? "Recheck requested" : "Awaiting you",
    },
    {
      label: "Date Confirmed",
      state: dated ? "done" : ag?.DateApprovalStatus === "Pending" ? "current" : "upcoming",
      note: dated ? fmtDate(ag?.AgreementDate) : ag?.DateApprovalStatus === "Pending" ? "Awaiting sign-off" : undefined,
    },
  ];
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
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{mimeIcon(doc.MimeType)} {doc.FileName || doc.DocumentType}</DialogTitle>
          <DialogDescription>{doc.DocumentType?.replace(/([A-Z])/g, " $1").trim()}{doc.VersionNo > 1 ? ` · version ${doc.VersionNo}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-slate-50 rounded-lg overflow-hidden">
          {!blobUrl ? <span className="text-sm text-slate-400">Loading preview…</span>
            : doc.MimeType?.startsWith("image/") ? <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[60vh] object-contain" />
            : doc.MimeType === "application/pdf" ? <iframe src={blobUrl} title={doc.FileName} className="w-full h-[60vh] border-0" />
            : <div className="flex flex-col items-center gap-2 py-8 text-slate-400 text-sm">{mimeIcon(doc.MimeType, 28)} Preview not available for this file type.</div>}
        </div>
        <div className="flex justify-between items-center text-xs text-slate-400 pt-1">
          <span>{fmtBytes(doc.FileSize)}</span>
          {blobUrl && (
            <a href={blobUrl} download={doc.FileName} style={{ color: GOLD }} className="hover:underline flex items-center gap-1">
              <Download size={12} /> Download
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UploadDocDialog({ doc, applicationId, onClose, onUploaded }: { doc: any; applicationId: number; onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const isResubmit = doc.Status === "Rejected";

  const submit = async () => {
    if (!file) { toast.error("Choose a file first"); return; }
    setSaving(true);
    try {
      await uploadAgreementDoc(doc.Id, file, applicationId);
      toast.success("Document submitted for review");
      onUploaded();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isResubmit ? "Re-submit Document" : "Upload Document"}</DialogTitle>
          <DialogDescription>
            {doc.Label || doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}{doc.IsMandatory ? " · required" : ""}
          </DialogDescription>
        </DialogHeader>

        {isResubmit && doc.Remarks && (
          <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span><strong>Why it was returned:</strong> {doc.Remarks}</span>
          </div>
        )}

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer text-center"
          style={{ borderColor: file ? INK : HAIRLINE, background: file ? GOLD_SOFT : SURFACE_ALT }}>
          <UploadCloud size={22} style={{ color: file ? INK : GOLD }} />
          <span className="text-sm font-medium" style={{ color: TEXT }}>{file ? file.name : "Click to choose a file"}</span>
          <span className="text-[11px]" style={{ color: TEXT_FAINT }}>{file ? fmtBytes(file.size) : "PDF, Word, or image · up to 25 MB"}</span>
          <input type="file" className="hidden" accept=".pdf,.doc,.docx,image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving || !file}
            className="px-4 py-1.5 text-sm text-white rounded-lg font-medium disabled:opacity-40" style={{ background: INK }}>
            {saving ? "Uploading..." : "Submit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProposeDateDialog({
  currentProposal, companyProposal, applicationId, onClose, onProposed,
}: { currentProposal: string | null; companyProposal: string | null; applicationId: number; onClose: () => void; onProposed: () => void }) {
  const [date, setDate] = useState(currentProposal ? String(currentProposal).slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!date) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const res = await proposeAgreementDate(date, applicationId);
      toast.success(res.agreementDateSubmittedForApproval
        ? "Both sides now agree — sent to our team for final sign-off"
        : "Your proposed date was sent to our team");
      onProposed();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{currentProposal ? "Update Your Proposed Date" : "Propose an Agreement Date"}</DialogTitle>
          <DialogDescription>
            {companyProposal
              ? `We proposed ${fmtDate(companyProposal)}. Pick the same date to move it forward for sign-off, or suggest another.`
              : "Suggest a date that works for you — we'll take it forward for sign-off the moment both sides agree."}
          </DialogDescription>
        </DialogHeader>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" style={{ color: TEXT, background: SURFACE }} />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg" style={{ color: TEXT_MUTED }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-1.5 text-sm text-white rounded-lg font-medium disabled:opacity-40" style={{ background: INK }}>
            {saving ? "Sending..." : "Submit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RespondDialog({
  title, summary, onClose, onSubmit,
}: {
  title: string;
  summary: { label: string; value: React.ReactNode }[];
  onClose: () => void;
  onSubmit: (decision: "Approve" | "Recheck", remarks: string) => void;
}) {
  const [mode, setMode] = useState<"choose" | "recheck">("choose");
  const [remarks, setRemarks] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  if (mode === "recheck") {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request a Recheck</DialogTitle>
            <DialogDescription>Tell us exactly what needs to be corrected — this goes straight to your assigned team.</DialogDescription>
          </DialogHeader>
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Review the details below carefully — approving is a binding confirmation on your end.</DialogDescription>
        </DialogHeader>

        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${HAIRLINE}` }}>
          {summary.map((row, i) => (
            <div key={row.label} className="flex items-center justify-between px-3.5 py-2.5 text-sm"
              style={{ background: i % 2 ? SURFACE_ALT : SURFACE }}>
              <span className="text-xs" style={{ color: TEXT_MUTED }}>{row.label}</span>
              <span className="font-medium" style={{ color: TEXT }}>{row.value ?? "—"}</span>
            </div>
          ))}
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-500 pt-1 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          I have reviewed all attached documents and the details above are correct.
        </label>

        <div className="grid grid-cols-1 gap-2 pt-1">
          <button
            disabled={!confirmed}
            onClick={() => onSubmit("Approve", "")}
            className="px-4 py-2.5 text-sm text-white rounded-lg font-medium text-left disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: INK }}
          >
            Approve
            <span className="block text-[11px] font-normal opacity-80">Everything looks correct</span>
          </button>
          <button onClick={() => setMode("recheck")}
            className="px-4 py-2.5 text-sm border border-slate-200 rounded-lg font-medium hover:bg-slate-50 text-left">
            Request a Recheck
            <span className="block text-[11px] font-normal text-slate-500">Something needs to be corrected</span>
          </button>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PortalAgreement: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [uploadDoc, setUploadDoc] = useState<any | null>(null);
  const [respondFor, setRespondFor] = useState<"agreement" | "salesDeed" | null>(null);
  const [proposeDateOpen, setProposeDateOpen] = useState(false);

  const { data: agreement } = useQuery({ queryKey: ["portal-agreement", applicationId], queryFn: () => fetchAgreement(applicationId) });
  const { data: documents = [] } = useQuery({ queryKey: ["portal-agreement-documents", applicationId], queryFn: () => fetchAgreementDocuments(applicationId) });

  // Two distinct piles: documents still waiting on the customer (requested
  // but never uploaded, or returned for correction) vs. documents that
  // already have a real file attached, regardless of who put it there.
  const needsAction = (documents as any[]).filter((d) => d.Status === "Requested" || d.Status === "Rejected");
  const onFile = (documents as any[]).filter((d) => d.FileName && d.Status !== "Rejected");
  const mandatoryOutstanding = needsAction.some((d: any) => d.IsMandatory);

  const respond = async (type: "agreement" | "salesDeed", decision: "Approve" | "Recheck", remarks: string) => {
    // The customer-facing UI calls it "Recheck"; the backend stores it as "Reject"
    const apiDecision: "Approve" | "Reject" = decision === "Approve" ? "Approve" : "Reject";
    try {
      if (type === "agreement") await respondAgreement(applicationId, apiDecision, remarks);
      else await respondSalesDeed(applicationId, apiDecision, remarks);
      toast.success(decision === "Approve" ? "Approved — thank you!" : "Recheck requested");
      setRespondFor(null);
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
      qc.invalidateQueries({ queryKey: ["portal-agreement", applicationId] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!agreement && !timeline.salesDeed) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Finance" title="Agreement" />
        <Card className="p-10 text-center">
          <div className="w-11 h-11 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: GOLD_SOFT, color: GOLD }}>
            <ScrollText size={20} />
          </div>
          <p className="text-sm font-medium" style={{ color: TEXT }}>Your agreement isn't ready yet</p>
          <p className="text-xs mt-1 max-w-xs mx-auto" style={{ color: TEXT_MUTED }}>We'll notify you the instant it clears in-house approval and is shared here for your review.</p>
        </Card>
      </div>
    );
  }

  const dateMismatch = agreement?.ProposedDateByCompany && agreement?.ProposedDateByCustomer
    && new Date(agreement.ProposedDateByCompany).toDateString() !== new Date(agreement.ProposedDateByCustomer).toDateString();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Finance · Legal" title="Agreement" subtitle="Track your agreement's approval journey, review its terms and documents, and record your decision." />

      {agreement && (
        <Card className="overflow-hidden">
          <div className="px-5 sm:px-6 py-5" style={{ background: `linear-gradient(135deg, ${INK} 0%, ${VIOLET} 100%)` }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">Agreement For Sale</p>
                <h2 className="text-lg sm:text-xl font-semibold text-white mt-0.5" style={serif}>{agreement.AgreementNo}</h2>
                <p className="text-[11px] text-white/60 mt-1 flex items-center gap-1.5" style={mono}>
                  <Hash size={10} /> v{agreement.VersionNo || 1} · {agreement.BookingNo}
                </p>
              </div>
              <StatusPill status={agreement.CustomerApprovalStatus} />
            </div>
          </div>

          <div className="px-5 sm:px-6 py-5 border-b" style={{ borderColor: HAIRLINE }}>
            <Stepper steps={agreementSteps(agreement)} />
          </div>

          <div className="px-5 sm:px-6 py-5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 text-sm">
            <InfoField label="Legal Name" value={agreement.LegalName} />
            <InfoField label="Project" value={agreement.ProjectName} />
            <InfoField label="Unit" value={agreement.UnitNo} />
            <InfoField label="Total Value" value={fmtMoney(agreement.TotalValue)} />
            <InfoField label="PAN" value={agreement.PanNo} mono />
            <InfoField label="Aadhaar" value={maskAadhaar(agreement.AadhaarNo)} mono />
            <InfoField label="Proposed Date (From the company)" value={fmtDate(agreement.ProposedDateByCompany)} />
            <InfoField label="Proposed Date (You)" value={fmtDate(agreement.ProposedDateByCustomer)} />
            <InfoField label="Agreement Date" value={fmtDate(agreement.AgreementDate)} />
            {agreement.LegalAddress && <InfoField label="Registered Address" value={agreement.LegalAddress} />}
            <InfoField label="Documents" value={needsAction.length > 0 ? `${onFile.length} on file, ${needsAction.length} needed` : onFile.length} />
          </div>

          {dateMismatch && !agreement.AgreementDate && agreement.DateApprovalStatus !== "Pending" && (
            <div className="mx-5 sm:mx-6 mb-5 text-xs rounded-lg p-3 flex items-start gap-2" style={{ background: GOLD_SOFT, color: "#8A6D14" }}>
              <CalendarCheck2 size={13} className="mt-0.5 shrink-0" />
              We proposed {fmtDate(agreement.ProposedDateByCompany)}; your response was {fmtDate(agreement.ProposedDateByCustomer)}. Once these dates match, it goes to our team for final sign-off.
            </div>
          )}

          {agreement.LastRecheckRemarks && (
            <div className="mx-5 sm:mx-6 mb-5 text-xs bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span><strong>Your last recheck note:</strong> {agreement.LastRecheckRemarks}{agreement.RecheckCount ? ` (requested ${agreement.RecheckCount}×)` : ""}</span>
            </div>
          )}

          <div className="px-5 sm:px-6 pb-5">
            {agreement.CustomerApprovalStatus === "Pending" && !!agreement.SentToCustomerAt ? (
              mandatoryOutstanding ? (
                <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#8A6D14" }}>
                  <UploadCloud size={16} /> Upload the required document{needsAction.filter((d: any) => d.IsMandatory).length > 1 ? "s" : ""} above before responding
                </div>
              ) : (
                <button onClick={() => setRespondFor("agreement")}
                  className="px-5 py-2.5 text-white text-sm font-semibold rounded-lg shadow-sm hover:opacity-90" style={{ background: INK }}>
                  Review & Respond
                </button>
              )
            ) : agreement.CustomerApprovalStatus === "Approved" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#0F7A44" }}>
                  <CheckCircle2 size={16} /> You approved this agreement on {fmtDate(agreement.CustomerApprovedAt)}
                </div>
                {!agreement.AgreementDate && (
                  agreement.DateApprovalStatus === "Pending" ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#8A6D14" }}>
                      <Clock size={16} /> Date agreed — awaiting our team's final sign-off
                    </div>
                  ) : (
                    <button onClick={() => setProposeDateOpen(true)}
                      className="px-5 py-2.5 text-white text-sm font-semibold rounded-lg shadow-sm hover:opacity-90 flex items-center gap-1.5" style={{ background: INK }}>
                      <CalendarCheck2 size={15} /> {agreement.ProposedDateByCustomer ? "Update Your Proposed Date" : "Propose Agreement Date"}
                    </button>
                  )
                )}
              </div>
            ) : agreement.CustomerApprovalStatus === "Recheck" ? (
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#A32C36" }}>
                <AlertTriangle size={16} /> Awaiting our team's revision — we'll re-share once updated
              </div>
            ) : null}
          </div>
        </Card>
      )}

      {needsAction.length > 0 && (
        <Card className="overflow-hidden border-amber-300">
          <CardHeader icon={UploadCloud} title={`Documents Needed From You (${needsAction.length})`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            {needsAction.map((d: any) => {
              const rejected = d.Status === "Rejected";
              return (
                <button key={d.Id} onClick={() => setUploadDoc(d)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:shadow-sm transition-shadow"
                  style={{ border: `1px solid ${rejected ? "#E8B4B4" : "#E8C766"}`, background: rejected ? "rgba(190,50,60,0.05)" : GOLD_SOFT }}>
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                    {rejected ? <XCircle size={16} className="text-rose-500" /> : <Clock size={16} style={{ color: GOLD }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: TEXT }}>
                      {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                      {d.IsMandatory ? <span className="text-rose-500"> *</span> : null}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: rejected ? "#A32C36" : "#8A6D14" }}>
                      {rejected ? "Returned — please re-upload" : "Requested — upload when ready"}
                    </p>
                  </div>
                  <UploadCloud size={14} className="shrink-0" style={{ color: rejected ? "#A32C36" : GOLD }} />
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {onFile.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader icon={FileText} title={`Attached Documents (${onFile.length})`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            {onFile.map((d: any) => (
              <button key={d.Id} onClick={() => setPreviewDoc(d)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:shadow-sm transition-shadow"
                style={{ border: `1px solid ${HAIRLINE}`, background: SURFACE_ALT }}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  {mimeIcon(d.MimeType, 17)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: TEXT }}>
                    {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}{d.VersionNo > 1 ? ` (v${d.VersionNo})` : ""}
                    {d.UploadedByType === "Customer" && <StatusPill status={d.Status} />}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: TEXT_FAINT }}>{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</p>
                </div>
                <Eye size={14} className="shrink-0" style={{ color: TEXT_FAINT }} />
              </button>
            ))}
          </div>
        </Card>
      )}

      {timeline.salesDeed?.SentToCustomerAt && (
        <Card className="overflow-hidden">
          <CardHeader icon={Landmark} title="Sales Deed" action={<StatusPill status={timeline.salesDeed.CustomerApprovalStatus} />} />
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <InfoField label="Deed No." value={timeline.salesDeed.DeedNo} mono />
              <InfoField label="Status" value={timeline.salesDeed.Status} />
              <InfoField label="Deed Value" value={fmtMoney(timeline.salesDeed.DeedValue)} />
              <InfoField label="Deed Date" value={fmtDate(timeline.salesDeed.DeedDate)} />
              <InfoField label="Sub-Registrar Office" value={timeline.salesDeed.SubRegistrarOffice} />
              <InfoField label="Registration No." value={timeline.salesDeed.RegistrationNo} />
            </div>
            {timeline.salesDeed.CustomerApprovalStatus === "Pending" ? (
              <button onClick={() => setRespondFor("salesDeed")}
                className="px-5 py-2.5 text-white text-sm font-semibold rounded-lg shadow-sm hover:opacity-90" style={{ background: INK }}>
                Review & Respond
              </button>
            ) : timeline.salesDeed.CustomerApprovalStatus === "Approved" ? (
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#0F7A44" }}><CheckCircle2 size={16} /> You've approved this sales deed</div>
            ) : null}
          </div>
        </Card>
      )}

      {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
      {proposeDateOpen && agreement && (
        <ProposeDateDialog
          currentProposal={agreement.ProposedDateByCustomer}
          companyProposal={agreement.ProposedDateByCompany}
          applicationId={applicationId}
          onClose={() => setProposeDateOpen(false)}
          onProposed={() => {
            setProposeDateOpen(false);
            qc.invalidateQueries({ queryKey: ["portal-agreement", applicationId] });
            qc.invalidateQueries({ queryKey: ["portal-timeline"] });
          }}
        />
      )}
      {uploadDoc && (
        <UploadDocDialog
          doc={uploadDoc}
          applicationId={applicationId}
          onClose={() => setUploadDoc(null)}
          onUploaded={() => {
            setUploadDoc(null);
            qc.invalidateQueries({ queryKey: ["portal-agreement-documents", applicationId] });
          }}
        />
      )}
      {respondFor && (
        <RespondDialog
          title={respondFor === "agreement" ? "Respond to Agreement" : "Respond to Sales Deed"}
          summary={
            respondFor === "agreement"
              ? [
                  { label: "Agreement No.", value: agreement?.AgreementNo },
                  { label: "Legal Name", value: agreement?.LegalName },
                  { label: "Unit", value: agreement?.UnitNo },
                  { label: "Total Value", value: fmtMoney(agreement?.TotalValue) },
                  { label: "Documents Attached", value: onFile.length },
                ]
              : [
                  { label: "Deed No.", value: timeline.salesDeed?.DeedNo },
                  { label: "Deed Value", value: fmtMoney(timeline.salesDeed?.DeedValue) },
                  { label: "Sub-Registrar Office", value: timeline.salesDeed?.SubRegistrarOffice },
                  { label: "Deed Date", value: fmtDate(timeline.salesDeed?.DeedDate) },
                ]
          }
          onClose={() => setRespondFor(null)}
          onSubmit={(decision, remarks) => respond(respondFor === "agreement" ? "agreement" : "salesDeed", decision, remarks)}
        />
      )}
    </div>
  );
};

export default PortalAgreement;
