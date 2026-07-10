import React from "react";
import { useOutletContext } from "react-router-dom";
import { HardHat, Home } from "lucide-react";
import { fmtDate, fmtDateTime } from "./portalApi";
import { PageHeader, Card, HAIRLINE, GOLD, TEXT, TEXT_MUTED, TEXT_FAINT, serif } from "./portalTheme";

type Ctx = { me: any; timeline: any };

const PortalConstruction: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const updates = timeline.constructionUpdates || [];
  const latest = updates[0];
  const handover = timeline.handover;

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
    </div>
  );
};

export default PortalConstruction;
