import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Home, FileCheck2, CheckCircle2, AlertTriangle, FileText, ShieldCheck, ClipboardCheck, Hammer, Megaphone, Wrench, Camera, X } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { fmtDate, openPossessionLetter, respondPossessionNotice, sitePhotoUrl } from "./portalApi";
import {
  HAIRLINE, GOLD, GOLD_SOFT, TEXT, TEXT_MUTED, TEXT_FAINT, INK, serif,
  HeroStrip, HeroStatCard, PulseBar, RingProgress, UrgencyBanner,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
} from "./portalTheme";

type Ctx = { me: any; timeline: any; applicationId: number; applications: any[] };

/** The handover readiness checks (CrmPrePossession), in the buyer's words — same as the mobile app. */
const READINESS: { key: "duesCleared" | "documentation" | "quality" | "utilities"; label: string }[] = [
  { key: "duesCleared", label: "Payments settled" },
  { key: "documentation", label: "Papers ready" },
  { key: "quality", label: "Quality inspection passed" },
  { key: "utilities", label: "Water, power and other utilities ready" },
];
const CARD = { background: "var(--portal-surface)", border: "1px solid var(--portal-hairline)", boxShadow: "0 1px 3px rgba(30,11,66,0.07)" };
const spaced = (x: string) => String(x || "").replace(/([a-z])([A-Z])/g, "$1 $2");

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

/** Site photos: the latest as a grid, click one to see it large (signed-in fetch per photo; same set as the app). */
function SitePhotos({ photos, applicationId }: { photos: any[]; applicationId: number }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [shown, setShown] = useState<any | null>(null);
  const ids = photos.map((p) => p.id).join(","); // refetch only when the set of photos changes
  useEffect(() => {
    let alive = true; const made: string[] = [];
    photos.forEach((p) => sitePhotoUrl(p.id, applicationId).then((u) => { made.push(u); if (alive) setUrls((m) => ({ ...m, [p.id]: u })); }).catch(() => undefined));
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, applicationId]);
  const caption = (p: any) => [p.activity, p.room, fmtDate(p.day || p.at)].filter(Boolean).join(" · ");
  return (
    <div className="rounded-2xl p-5" style={CARD}>
      <div className="flex items-center gap-2 mb-1"><Camera size={15} style={{ color: GOLD }} /><p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Photos from site</p></div>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>Taken by our site engineers as work is done — your unit, and shared work on your tower.</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((p) => (
          <button key={p.id} type="button" onClick={() => setShown(p)} title={caption(p)} className="aspect-square rounded-xl overflow-hidden" style={{ background: "var(--portal-surface-alt)" }}>
            {urls[p.id] ? <img src={urls[p.id]} alt={caption(p)} className="w-full h-full object-cover" loading="lazy" /> : null}
          </button>
        ))}
      </div>
      {shown && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-6" style={{ background: "rgba(0,0,0,0.9)" }} onClick={() => setShown(null)} role="dialog" aria-label={caption(shown)}>
          <button type="button" aria-label="Close" className="absolute top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}><X size={20} color="#fff" /></button>
          {urls[shown.id] && <img src={urls[shown.id]} alt={caption(shown)} className="max-h-[75vh] max-w-full rounded-xl object-contain" />}
          <div className="text-center">
            <p className="text-white font-semibold">{shown.activity}</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>{[shown.work, shown.room, shown.ownUnit ? "Your unit" : "Shared work", fmtDate(shown.day || shown.at)].filter(Boolean).join(" · ")}</p>
            {shown.note && <p className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{shown.note}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const PortalConstruction: React.FC = () => {
  const { timeline, applicationId } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  // The booked unit's own progress; until the site records it, its tower's or the whole project's (server decides).
  const mine = timeline.constructionProgress;
  const live = mine?.unit || null;
  const scopeNote = mine?.scope === "tower" ? `Your unit's own progress isn't recorded yet, so this is ${mine.towerName ? `tower ${mine.towerName}` : "your tower"} as a whole.`
    : mine?.scope === "project" ? "Your unit's own progress isn't recorded yet, so this is the whole project." : `Showing progress recorded for ${timeline.booking?.UnitNo || "your booked unit"} only.`;
  const notes: any[] = timeline.siteNotes || [];
  const snags: any[] = timeline.snags || [];
  const snagsOpen = snags.filter((x) => x.IsOpen).length;
  const bookedUnit = timeline.booking?.UnitNo || "Your booked unit";
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

  const pct = live?.pct ?? 0;

  return (
    <div className="space-y-5">
      {/* Premium hero strip */}
      <HeroStrip
        eyebrow="My Property"
        title="Construction"
        subtitle={`Progress updates for your booked unit: ${bookedUnit}`}
        gradient={handover?.ActualHandoverDate ? "green" : "violet"}
      >
        {live && (
          <div className="grid grid-cols-2 gap-3">
            <HeroStatCard
              label="Overall complete"
              value={`${pct}%`}
              sub={live.allDone ? "Construction complete 🎉" : live.now.length ? `${live.now[0]?.name} in progress` : "Not started yet"}
              highlight
            />
            <HeroStatCard
              label="Coming next"
              value={live.next || (live.allDone ? "Handover!" : "—")}
              sub={live.allDone ? "All works complete" : undefined}
            />
          </div>
        )}
      </HeroStrip>

      {/* Handover celebration banner */}
      {handover?.ActualHandoverDate && (
        <UrgencyBanner
          icon={Home}
          title="🎉 Your property has been handed over!"
          sub={`Handed over on ${fmtDate(handover.ActualHandoverDate)}. Welcome home!`}
          level="success"
        />
      )}

      {/* Possession notice urgency banner */}
      {notice?.Status === "Sent" && (
        <UrgencyBanner
          icon={FileCheck2}
          title={`Possession Notice ${notice.NoticeNo} — your response needed`}
          sub={notice.OfferedDate ? `Property offered for ${fmtDate(notice.OfferedDate)}${notice.ResponseDeadline ? ` · respond by ${fmtDate(notice.ResponseDeadline)}` : ""}` : "Review and respond below"}
          level="warning"
        />
      )}

      {/* Main progress card with ring + bars */}
      {live && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          {/* Top section with ring */}
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-6">
              <RingProgress pct={pct} size={110} label="Complete" sublabel={mine?.scope === "unit" ? bookedUnit : mine?.scope === "tower" ? (mine.towerName ? `Tower ${mine.towerName}` : "Your tower") : "Whole project"} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_FAINT }}>
                  {live.allDone ? "All works completed!" : "Active works"}
                </p>
                {live.now.length > 0 ? (
                  <div className="space-y-1.5">
                    {live.now.slice(0, 3).map((w: any) => (
                      <div key={w.name} className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: GOLD }} />
                        <span className="font-medium truncate" style={{ color: TEXT }}>{w.name}</span>
                        <span className="ml-auto font-semibold tabular-nums shrink-0" style={{ color: GOLD }}>{w.pct}%</span>
                      </div>
                    ))}
                    {live.next && (
                      <p className="text-xs pt-1" style={{ color: TEXT_MUTED }}>Next: {live.next}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: TEXT_MUTED }}>
                    {live.allDone ? "Every work item is 100% complete." : "Construction not started yet."}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Individual work bars */}
          {live.works.length > 0 && (
            <div className="px-5 pb-5 space-y-3" style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: "1.25rem" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_FAINT }}>All work items</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {live.works.map((w: any) => (
                  <div key={w.name}>
                    <div className="flex justify-between items-center mb-1">
                      <span
                        className="text-xs truncate"
                        style={{ color: w.pct >= 100 ? "#059669" : w.pct > 0 ? TEXT : TEXT_FAINT, fontWeight: w.pct > 0 && w.pct < 100 ? 600 : 400 }}
                      >
                        {w.pct >= 100 ? "✓ " : ""}{w.name}
                      </span>
                      <span className="text-xs tabular-nums ml-2 shrink-0" style={{ color: TEXT_MUTED }}>{w.pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: HAIRLINE }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, w.pct)}%`,
                          background: w.pct >= 100 ? "#059669" : GOLD,
                          transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity feed */}
          {mine.feed?.length > 0 && (
            <div className="px-5 pb-5" style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: "1.25rem" }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_FAINT }}>Recent updates</p>
              <div className="space-y-2">
                {mine.feed.slice(0, 6).map((f: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-xs py-2 px-3 rounded-xl" style={{ background: "var(--portal-surface-alt)" }}>
                    <div className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: GOLD }} />
                      <span style={{ color: TEXT }}>
                        {f.activity}{f.room ? <span style={{ color: TEXT_MUTED }}> · {f.room}</span> : null}
                        {" "}—{" "}
                        {f.completed ? "completed" : f.from != null ? `${f.from}% → ${f.to}%` : `${f.to}%`}
                      </span>
                    </div>
                    <span className="shrink-0" style={{ color: TEXT_FAINT }}>{fmtDate(f.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="px-5 pb-4 text-[0.6875rem]" style={{ color: TEXT_FAINT }}>{scopeNote}</p>
        </div>
      )}

      {/* Closure checklist */}
      {closureItems.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_FAINT }}>Closure Checklist</p>
          <div className="space-y-3">
            {closureItems.map((item, i) => (
              <div key={i} className="flex items-center gap-4 py-2 px-3 rounded-xl" style={{ background: item.done ? "rgba(5,150,105,0.05)" : GOLD_SOFT }}>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: item.done ? "rgba(5,150,105,0.14)" : "rgba(201,162,39,0.14)", color: item.done ? "#059669" : GOLD }}
                >
                  <item.icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{item.label}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {item.done ? (
                    <CheckCircle2 size={16} style={{ color: "#059669" }} />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: GOLD }} />
                  )}
                  <span className="text-xs font-medium" style={{ color: item.done ? "#059669" : TEXT_MUTED }}>{item.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {timeline.sitePhotos?.length > 0 && <SitePhotos photos={timeline.sitePhotos} applicationId={applicationId} />}

      {/* Notes the site team writes for buyers */}
      {notes.length > 0 && (
        <div className="rounded-2xl p-5" style={CARD}>
          <div className="flex items-center gap-2 mb-3"><Megaphone size={15} style={{ color: GOLD }} /><p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>From the site team</p></div>
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.Id} className="pb-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                <p className="text-[0.6875rem] font-semibold" style={{ color: TEXT_MUTED }}>
                  {[fmtDate(n.UpdateDate), n.Stage, n.PercentComplete != null ? `${Number(n.PercentComplete)}% complete` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm mt-1 whitespace-pre-line" style={{ color: TEXT }}>{n.Summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Before handover: the readiness checks and the inspection visit */}
      {prePossession?.checks && (
        <div className="rounded-2xl p-5" style={CARD}>
          <div className="flex items-center gap-2 mb-3"><ClipboardCheck size={15} style={{ color: GOLD }} /><p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Getting ready for handover</p></div>
          <div className="space-y-2">
            {READINESS.map((c) => (
              <div key={c.key} className="flex items-center gap-3 text-sm">
                {prePossession.checks[c.key] ? <CheckCircle2 size={16} style={{ color: "#059669" }} /> : <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: TEXT_FAINT }} />}
                <span className="flex-1" style={{ color: prePossession.checks[c.key] ? TEXT : TEXT_MUTED }}>{c.label}</span>
                <span className="text-xs font-medium" style={{ color: prePossession.checks[c.key] ? "#059669" : TEXT_FAINT }}>{prePossession.checks[c.key] ? "Done" : "Pending"}</span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3 pt-3" style={{ borderTop: `1px solid ${HAIRLINE}`, color: TEXT_MUTED }}>
            {prePossession.completedDate ? `Inspection done on ${fmtDate(prePossession.completedDate)}`
              : prePossession.scheduledDate ? `Inspection visit on ${fmtDate(prePossession.scheduledDate)}`
              : "We'll tell you the date of your inspection visit once the checks above are done."}
          </p>
        </div>
      )}

      {/* Snags found at the inspection and whether each is fixed */}
      {snags.length > 0 && (
        <div className="rounded-2xl p-5" style={CARD}>
          <div className="flex items-center gap-2 mb-1"><Wrench size={15} style={{ color: GOLD }} /><p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>Snags ({snagsOpen ? `${snagsOpen} being fixed` : "all fixed"})</p></div>
          <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>Small faults noted at the inspection. We fix each one before you move in.</p>
          <div className="space-y-2">
            {snags.map((x) => (
              <div key={x.Id} className="flex items-start justify-between gap-3 text-sm py-2 px-3 rounded-xl" style={{ background: "var(--portal-surface-alt)" }}>
                <div className="min-w-0">
                  <p style={{ color: TEXT }}>{x.Description}</p>
                  <p className="text-[0.6875rem] mt-0.5" style={{ color: TEXT_FAINT }}>
                    {[x.Category, `noted ${fmtDate(x.CreatedAt)}`, x.ResolvedAt ? `fixed ${fmtDate(x.ResolvedAt)}` : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color: x.IsOpen ? GOLD : "#059669" }}>{spaced(x.Status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Possession notice actions */}
      {notice && (
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{
            background: "var(--portal-surface)",
            border: notice.Status === "Sent" ? "1.5px solid #E8C766" : `1px solid var(--portal-hairline)`,
            boxShadow: "0 1px 3px rgba(30,11,66,0.07)",
          }}
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
              <FileCheck2 size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ ...serif, color: TEXT }}>
                Possession Notice — {notice.NoticeNo}
              </p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                {notice.OfferedDate ? `Offered for ${fmtDate(notice.OfferedDate)}` : "Offer details pending"}
                {notice.ResponseDeadline ? ` · respond by ${fmtDate(notice.ResponseDeadline)}` : ""}
              </p>
            </div>
            <button
              onClick={() => openPossessionLetter(notice.Id, applicationId).catch((e) => toast.error(e.message))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0"
              style={{ border: `1px solid ${HAIRLINE}`, color: TEXT }}
            >
              <FileText size={13} /> View Letter
            </button>
          </div>

          {notice.Status === "Sent" && (
            <div className="flex items-center gap-3">
              <button
                onClick={acknowledge}
                className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm hover:opacity-90 transition-opacity"
                style={{ background: INK }}
              >
                <CheckCircle2 size={16} /> Accept Possession
              </button>
              <button
                onClick={() => setDisputeOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <AlertTriangle size={16} /> Raise Dispute
              </button>
            </div>
          )}
          {notice.Status === "Acknowledged" && (
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#059669" }}>
              <CheckCircle2 size={16} /> You acknowledged this notice on {fmtDate(notice.AcknowledgedAt)}
            </div>
          )}
          {notice.Status === "Disputed" && (
            <div className="text-sm">
              <div className="flex items-center gap-2 font-medium" style={{ color: "#A32C36" }}>
                <AlertTriangle size={16} /> You disputed this notice on {fmtDate(notice.DisputedAt)}
              </div>
              {notice.DisputeReason && <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>{notice.DisputeReason}</p>}
            </div>
          )}
        </div>
      )}

      {/* Handover card (past tense - already handed over) */}
      {handover && !handover.ActualHandoverDate && (
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)`, boxShadow: "0 1px 3px rgba(30,11,66,0.07)" }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(5,150,105,0.10)", color: "#059669" }}>
            <Home size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: TEXT }}>Handover scheduled</p>
            <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
              {handover.ScheduledDate ? `Planned for ${fmtDate(handover.ScheduledDate)}` : handover.Status}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!live && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(201,162,39,0.10)" }}>
            <Hammer size={28} style={{ color: GOLD }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: TEXT }}>Construction updates coming soon</p>
            <p className="text-sm mt-1 max-w-xs" style={{ color: TEXT_MUTED }}>
              Progress will appear here as soon as the site team starts recording work on your project.
            </p>
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
