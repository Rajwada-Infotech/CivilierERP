import React from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, Inbox, GitBranch, PhoneCall, Repeat, CalendarCheck, MapPin, Award, XCircle, IndianRupee, ChevronRight, Handshake } from "lucide-react";
import { ACCENT } from "@/components/sa/SalesAutoShell";
import { LEAD_STAGES, type LeadStage } from "@/components/sa/leadStages";

// The lead lifecycle as one connected strip: where leads come from, every
// SaLead.Status from the shared LEAD_STAGES list, then payout. Counts are
// "leads at this status right now" (statusCounts from /api/sa/dashboard/sales)
// — snapshots, not cumulative totals, so no stage-to-stage % is derived.

const STAGE_ICONS: Record<string, React.ElementType> = {
  New: Inbox, Assigned: GitBranch, Contacted: PhoneCall, FollowUp: Repeat,
  VisitScheduled: CalendarCheck, Visited: MapPin, Converted: Handshake, Booking: Award, Lost: XCircle,
};

const SOURCE = { key: "source", label: "Campaigns", hint: "Platforms → campaigns → ads", path: "/sales-automation/social-media", hex: "#8b5cf6" };
const PAYOUT = { key: "payout", label: "Commissions", hint: "Settle rep & partner pay", path: "/sales-automation/commissions", hex: ACCENT };

const FLOW = LEAD_STAGES.filter((s) => s.key !== "Lost");
const LOST = LEAD_STAGES.find((s) => s.key === "Lost")!;

type Card = Pick<LeadStage, "key" | "label" | "hint" | "path" | "hex">;

const StageCard: React.FC<{ s: Card; icon: React.ElementType; n?: number; onClick: () => void }> = ({ s, icon: Icon, n, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="group min-w-[8rem] flex-1 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
    style={{ borderColor: `${s.hex}40`, background: `linear-gradient(160deg, ${s.hex}14, transparent 70%)` }}
  >
    <div className="flex items-center justify-between mb-2">
      <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${s.hex}22`, color: s.hex }}>
        <Icon size={14} />
      </span>
      {n !== undefined && <span className="text-lg font-bold tabular-nums" style={{ color: s.hex }}>{n}</span>}
    </div>
    <p className="text-xs font-semibold text-foreground">{s.label}</p>
    <p className="text-[0.6875rem] text-muted-foreground leading-snug">{s.hint}</p>
  </button>
);

const Arrow = () => <ChevronRight size={16} className="self-center shrink-0 text-muted-foreground/50" />;

export const SaWorkflowFunnel: React.FC<{ data?: any }> = ({ data }) => {
  const navigate = useNavigate();
  const counts: Record<string, number> = data?.statusCounts ?? {};
  const total = data?.totalLeads ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Lead Workflow</h3>
        <p className="text-xs text-muted-foreground">
          {total} active leads · {data?.conversionPercentage ?? 0}% converted
        </p>
      </div>

      {/* Rail: each status's share of active leads, Lost included, so it adds up. */}
      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted mb-4">
          {LEAD_STAGES.map((s) => (
            <div key={s.key} title={`${s.label}: ${counts[s.key] ?? 0}`} style={{ width: `${((counts[s.key] ?? 0) / total) * 100}%`, background: s.hex }} />
          ))}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <StageCard s={SOURCE} icon={Megaphone} onClick={() => navigate(SOURCE.path)} />
        {FLOW.map((s) => (
          <React.Fragment key={s.key}>
            <Arrow />
            <StageCard s={s} icon={STAGE_ICONS[s.key]} n={counts[s.key] ?? 0} onClick={() => navigate(s.path)} />
          </React.Fragment>
        ))}
        <Arrow />
        <StageCard s={PAYOUT} icon={IndianRupee} onClick={() => navigate(PAYOUT.path)} />
      </div>

      <button
        type="button"
        onClick={() => navigate(LOST.path)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <XCircle size={12} style={{ color: LOST.hex }} />
        {counts.Lost ?? 0} lost leads
      </button>
    </div>
  );
};
