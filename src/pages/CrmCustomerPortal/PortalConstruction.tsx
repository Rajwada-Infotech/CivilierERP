import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HardHat, Home, FileCheck2, CheckCircle2, AlertTriangle, FileText, ShieldCheck, ClipboardCheck } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { fmtDate, fmtDateTime, respondPossessionNotice } from "./portalApi";
import {
  PageHeader, Card, HAIRLINE, GOLD, GOLD_SOFT, TEXT, TEXT_MUTED, TEXT_FAINT, INK, serif,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

function DisputeDialog({ applicationId, onClose, onSubmitted }: { applicationId: number; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { toast.error("A reason is required"); return; }
    setSaving(true);
    try {
      await respondPossessionNotice("Dispute", applicationId, reason);
      toast.success("Dispute submitted — our team will follow up");
      onSubmitted();
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
          <DialogTitle>Dispute Possession Notice</DialogTitle>
          <DialogDescription>Tell us exactly what's wrong — this goes straight to your assigned team.</DialogDescription>
        </DialogHeader>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
          placeholder="e.g. Unit isn't ready, snags unresolved, dates don't work..."
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none" />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg" style={{ color: TEXT_MUTED }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-40">
            {saving ? "Submitting..." : "Submit Dispute"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PortalConstruction: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  const updates = timeline.constructionUpdates || [];
  const latest = updates[0];
  const handover = timeline.handover;
  const notice = timeline.possessionNotice;
  const legalDoc = timeline.legalDocumentation;
  const noc = timeline.nocStatus;
  const prePossession = timeline.prePossession;
  const [disputeOpen, setDisputeOpen] = useState(false);

  const closureItems = [
    legalDoc && {
      icon: FileText,
      label: "Legal Documentation",
      done: legalDoc.status === "Completed",
      text: legalDoc.status === "Completed" ? "Completed" : "In progress",
    },
    noc && noc.total > 0 && {
      icon: ShieldCheck,
      label: "No-Objection Certificates",
      done: noc.issued === noc.total,
      text: `${noc.issued} of ${noc.total} issued`,
    },
    prePossession && {
      icon: ClipboardCheck,
      label: "Pre-Possession Inspection",
      done: prePossession.status === "Ready",
      text: prePossession.status === "Ready" ? "Ready" : prePossession.scheduledDate ? `Scheduled ${fmtDate(prePossession.scheduledDate)}` : "Pending",
    },
  ].filter(Boolean) as { icon: any; label: string; done: boolean; text: string }[];

  const acknowledge = async () => {
    try {
      await respondPossessionNotice("Acknowledge", applicationId);
      toast.success("Possession notice acknowledged");
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="My Property" title="Construction Progress" subtitle="Live updates from the site, shared as they happen." />

      {latest?.PercentComplete != null && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs" style={{ color: TEXT_FAINT }}>Overall — {latest.Stage}</span>
            <span className="text-xs font-semibold" style={{ color: TEXT }}>{latest.PercentComplete}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, latest.PercentComplete)}%`, background: GOLD }} />
          </div>
          <p className="text-[11px] mt-2" style={{ color: TEXT_FAINT }}>Last updated {fmtDateTime(latest.UpdateDate)}</p>
        </Card>
      )}

      {closureItems.length > 0 && (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_FAINT }}>Closure Checklist</p>
          <div className="space-y-3">
            {closureItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: item.done ? "rgba(16,150,80,0.10)" : GOLD_SOFT, color: item.done ? "#0F7A44" : GOLD }}>
                  <item.icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{item.label}</p>
                </div>
                <span className="text-xs font-medium shrink-0" style={{ color: item.done ? "#0F7A44" : TEXT_MUTED }}>{item.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {notice && (
        <Card className="p-5 space-y-3" style={notice.Status === "Sent" ? { borderColor: "#E8C766" } : undefined}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <FileCheck2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Possession Notice — {notice.NoticeNo}</p>
              <p className="text-xs" style={{ color: TEXT_MUTED }}>
                {notice.OfferedDate ? `Offered for ${fmtDate(notice.OfferedDate)}` : "Offer details pending"}
                {notice.ResponseDeadline ? ` · respond by ${fmtDate(notice.ResponseDeadline)}` : ""}
              </p>
            </div>
          </div>

          {notice.Status === "Sent" && (
            <div className="flex items-center gap-2 pt-1">
              <button onClick={acknowledge}
                className="flex items-center gap-1.5 px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm hover:opacity-90" style={{ background: INK }}>
                <CheckCircle2 size={15} /> Acknowledge
              </button>
              <button onClick={() => setDisputeOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">
                <AlertTriangle size={15} /> Dispute
              </button>
            </div>
          )}
          {notice.Status === "Acknowledged" && (
            <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "#0F7A44" }}>
              <CheckCircle2 size={16} /> You acknowledged this notice on {fmtDate(notice.AcknowledgedAt)}
            </div>
          )}
          {notice.Status === "Disputed" && (
            <div className="text-sm">
              <div className="flex items-center gap-1.5 font-medium" style={{ color: "#A32C36" }}>
                <AlertTriangle size={16} /> You disputed this notice on {fmtDate(notice.DisputedAt)}
              </div>
              {notice.DisputeReason && <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>{notice.DisputeReason}</p>}
            </div>
          )}
        </Card>
      )}

      {handover && (
        <Card className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(16,150,80,0.10)", color: "#0F7A44" }}>
            <Home size={16} />
          </div>
          <div className="text-sm">
            <p className="font-semibold" style={{ color: TEXT }}>
              {handover.ActualHandoverDate ? "Handed over" : "Handover scheduled"}
            </p>
            <p className="text-xs" style={{ color: TEXT_MUTED }}>
              {handover.ActualHandoverDate ? fmtDate(handover.ActualHandoverDate) : handover.ScheduledDate ? `Planned for ${fmtDate(handover.ScheduledDate)}` : handover.Status}
            </p>
          </div>
        </Card>
      )}

      {updates.length === 0 ? (
        <Card className="p-8 text-center text-sm" style={{ color: TEXT_MUTED }}>
          No construction updates have been posted yet — check back soon.
        </Card>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[9px] top-2 bottom-2 w-0.5" style={{ background: HAIRLINE }} />
          <div className="space-y-5">
            {updates.map((u: any, i: number) => (
              <div key={i} className="relative">
                <div className="absolute -left-6 top-1 w-4 h-4 rounded-full border-4" style={{ background: GOLD, borderColor: "#F3ECD8" }} />
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold flex items-center gap-1.5" style={{ ...serif, color: TEXT }}><HardHat size={14} style={{ color: GOLD }} /> {u.Stage}</span>
                    <span className="text-[11px]" style={{ color: TEXT_FAINT }}>{fmtDate(u.UpdateDate)}</span>
                  </div>
                  {u.PercentComplete != null && (
                    <div className="mb-2">
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, u.PercentComplete)}%`, background: GOLD }} />
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: TEXT_FAINT }}>{u.PercentComplete}% complete</p>
                    </div>
                  )}
                  {u.Summary && <p className="text-sm" style={{ color: TEXT_MUTED }}>{u.Summary}</p>}
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}

      {disputeOpen && (
        <DisputeDialog
          applicationId={applicationId}
          onClose={() => setDisputeOpen(false)}
          onSubmitted={() => {
            setDisputeOpen(false);
            qc.invalidateQueries({ queryKey: ["portal-timeline"] });
          }}
        />
      )}
    </div>
  );
};

export default PortalConstruction;
