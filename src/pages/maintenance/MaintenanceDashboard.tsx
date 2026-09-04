import { Wrench, ClipboardList, CalendarClock, CheckCircle2 } from "lucide-react";
import { GlassShell, GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";

const ACCENT = "#64748b";

// Scaffold dashboard — the Maintenance module has no pages/data model yet
// (this is step one: get it into the module strip + sidebar + routing).
// Stat tiles stay at "—" rather than showing fake zeros, and the section
// below says plainly that nothing's wired up yet, instead of pretending
// there's real data behind an empty grid.
export default function MaintenanceDashboard() {
  usePageRights("maintenance-dashboard");

  return (
    <GlassShell
      title="Maintenance"
      subtitle="Upkeep, repairs & servicing"
      icon={Wrench}
      accentColor={ACCENT}
    >
      <Breadcrumbs items={["Dashboard", "Maintenance"]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard label="Open Requests" value="—" icon={ClipboardList} accentColor={ACCENT} />
        <GlassCard label="Due This Week" value="—" icon={CalendarClock} accentColor="#f59e0b" />
        <GlassCard label="Completed" value="—" icon={CheckCircle2} accentColor="#22c55e" />
        <GlassCard label="Overdue" value="—" icon={Wrench} accentColor="#ef4444" />
      </div>

      <GlassSection title="Getting Started" icon={Wrench} accentColor={ACCENT}>
        <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2.5 text-center px-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}28` }}
          >
            <Wrench size={17} style={{ color: ACCENT }} />
          </div>
          <p className="text-sm font-medium text-foreground">Maintenance module scaffolded</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            This is the starting shell — module strip entry, sidebar, and this dashboard.
            Real pages (maintenance requests, schedules, work orders) get added here next.
          </p>
        </div>
      </GlassSection>
    </GlassShell>
  );
}
