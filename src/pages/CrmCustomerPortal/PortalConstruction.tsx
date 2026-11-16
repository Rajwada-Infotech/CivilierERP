import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Home, FileCheck2, CheckCircle2, AlertTriangle, FileText, ShieldCheck, ClipboardCheck } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { fmtDate, openPossessionLetter, respondPossessionNotice } from "./portalApi";
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
          placeholder="e.g. Unit isn't ready, snags unresolved, dates don't work…"
          className="w-full text-sm rounded-lg px-3 py-2 resize-none outline-none" style={{ border: `1px solid ${HAIRLINE}`, background: "transparent", color: TEXT }} />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg" style={{ border: `1px solid ${HAIRLINE}`, color: TEXT_MUTED }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-40">
            {saving ? "Submitting…" : "Submit Dispute"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PortalConstruction: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  // The buyer's own unit as the site records it, with its tower and project for context.
  const mine = timeline.constructionProgress;
  const live = mine ? (mine.unit || mine.tower || mine.project) : null;
  const liveLabel = !mine ? "" : mine.unit ? "Your home" : mine.tower ? `Your tower (${mine.tower.blockName})` : "The project";
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

      {live && (
        <Card className="p-5 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs" style={{ color: TEXT_FAINT }}>{liveLabel}</p>
              <p className="text-sm mt-1" style={{ color: TEXT }}>
                {live.allDone ? "All work complete" : live.now.length ? <>Now: {live.now.slice(0, 2).map((w: any) => `${w.name} ${w.pct}%`).join(" · ")}</> : "Work not started yet"}
                {!live.allDone && live.next ? <span style={{ color: TEXT_MUTED }}> · Next: {live.next}</span> : null}
              </p>
            </div>
            <span className="text-2xl font-semibold tabular-nums" style={{ ...serif, color: TEXT }}>{live.pct}%</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: HAIRLINE }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, live.pct || 0)}%`, background: GOLD }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {live.works.map((w: any) => (
              <div key={w.name} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate" style={{ color: w.pct > 0 ? TEXT : TEXT_FAINT, fontWeight: w.pct > 0 && w.pct < 100 ? 600 : 400 }}>{w.pct >= 100 ? "✓ " : ""}{w.name}</span>
                <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: HAIRLINE }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, w.pct)}%`, background: GOLD }} />
                </div>
                <span className="w-9 text-right tabular-nums" style={{ color: TEXT_MUTED }}>{w.pct}%</span>
              </div>
            ))}
          </div>
          <p className="text-[0.6875rem]" style={{ color: TEXT_FAINT }}>
            Live from the site's daily progress records.{mine.scope === "unit" && mine.tower ? ` Tower ${mine.tower.blockName}: ${mine.tower.pct}%.` : ""}{mine.scope !== "project" ? ` Whole project: ${mine.project.pct}%.` : ""}
          </p>
          {mine.feed?.length > 0 && (
            <div className="pt-3 space-y-1.5" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_FAINT }}>Recent work</p>
              {mine.feed.slice(0, 6).map((f: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-3 text-xs">
                  <span style={{ color: TEXT }}>{f.activity}{f.room ? <span style={{ color: TEXT_MUTED }}> · {f.room}</span> : null} — {f.completed ? "completed" : f.from != null ? `${f.from}% → ${f.to}%` : `${f.to}%`}</span>
                  <span className="shrink-0" style={{ color: TEXT_FAINT }}>{fmtDate(f.at)}</span>
                </div>
              ))}
            </div>
          )}
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
            <button onClick={() => openPossessionLetter(notice.Id, applicationId).catch((e) => toast.error(e.message))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0" style={{ border: `1px solid ${HAIRLINE}`, color: TEXT }}>
              <FileText size={13} /> View Letter
            </button>
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

      {!live && (
        <Card className="p-8 text-center text-sm" style={{ color: TEXT_MUTED }}>
          "Project construction progress will appear here automatically as site updates are recorded."
        </Card>
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
