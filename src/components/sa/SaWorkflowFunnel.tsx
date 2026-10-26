import React from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, Inbox, GitBranch, PhoneCall, MapPin, Award, IndianRupee, ChevronRight } from "lucide-react";
import { ACCENT } from "@/components/sa/SalesAutoShell";

// The lead lifecycle as one connected strip, in the same order as the
// sidebar (SalesAutomationSidebar.ts). Counts come from the sales dashboard
// payload and are "leads sitting at this stage right now" — the API returns
// current-status snapshots, not cumulative totals, so no stage-to-stage %
// is derived from them.

interface Stage {
  key: string;
  label: string;
  hint: string;
  path: string;
  icon: React.ElementType;
  color: string;
  count?: (d: any) => number | undefined;
}

const STAGES: Stage[] = [
  { key: "source",   label: "Campaigns",   hint: "Platforms → campaigns → ads", path: "/sales-automation/social-media",    icon: Megaphone,  color: "#8b5cf6" },
  { key: "new",      label: "New",         hint: "Inquiries awaiting a rep",   path: "/sales-automation/distribution", icon: Inbox,      color: "#3b82f6", count: (d) => d?.pendingLeads },
  { key: "assigned", label: "Assigned",    hint: "With a rep, not yet called", path: "/sales-automation/leads",        icon: GitBranch,  color: "#06b6d4", count: (d) => d?.assignedLeads },
  { key: "engaged",  label: "Contacted",   hint: "Follow-ups in progress",     path: "/sales-automation/followups",    icon: PhoneCall,  color: "#f59e0b", count: (d) => d?.contactedLeads },
  { key: "visit",    label: "Site Visits", hint: "Visits completed",           path: "/sales-automation/site-visits",  icon: MapPin,     color: "#f97316", count: (d) => d?.siteVisitsCompleted },
  { key: "booked",   label: "Booked",      hint: "Handed to CRM",              path: "/sales-automation/pipeline",     icon: Award,      color: "#22c55e", count: (d) => d?.bookingsGenerated },
  { key: "payout",   label: "Commissions", hint: "Settle rep & partner pay",   path: "/sales-automation/commissions",  icon: IndianRupee, color: ACCENT },
];

export const SaWorkflowFunnel: React.FC<{ data?: any }> = ({ data }) => {
  const navigate = useNavigate();
  const total = data?.totalLeads ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Lead Workflow</h3>
        <p className="text-xs text-muted-foreground">
          {total} active leads · {data?.conversionPercentage ?? 0}% converted
        </p>
      </div>

      {/* Progress rail: each segment's width is its share of active leads. */}
      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted mb-4">
          {STAGES.filter((s) => s.count).map((s) => (
            <div key={s.key} style={{ width: `${((s.count!(data) ?? 0) / total) * 100}%`, background: s.color }} />
          ))}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const n = s.count?.(data);
          return (
            <React.Fragment key={s.key}>
              <button
                type="button"
                onClick={() => navigate(s.path)}
                className="group min-w-[8.5rem] flex-1 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: `${s.color}40`, background: `linear-gradient(160deg, ${s.color}14, transparent 70%)` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${s.color}22`, color: s.color }}>
                    <Icon size={14} />
                  </span>
                  {n !== undefined && (
                    <span className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{n}</span>
                  )}
                </div>
                <p className="text-xs font-semibold text-foreground">{s.label}</p>
                <p className="text-[0.6875rem] text-muted-foreground leading-snug">{s.hint}</p>
              </button>
              {i < STAGES.length - 1 && (
                <ChevronRight size={16} className="self-center shrink-0 text-muted-foreground/50" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
