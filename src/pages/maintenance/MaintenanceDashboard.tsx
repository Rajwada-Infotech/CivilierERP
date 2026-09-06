import { useNavigate } from "react-router-dom";
import { Wrench, ClipboardList, CalendarClock, CheckCircle2, Users, Receipt, ChevronRight } from "lucide-react";
import { GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";

// Requests/schedules/work-orders still have no data model — those tiles
// stay at "—" rather than showing fake zeros. Customer Directory + Charge
// Head master are real now (see src/pages/maintenance/MaintenanceDirectory.tsx).
export default function MaintenanceDashboard() {
  usePageRights("maintenance-dashboard");
  const navigate = useNavigate();

  return (
    <MaintenanceShell
      title="Maintenance"
      subtitle="Upkeep, repairs & servicing"
      icon={Wrench}
    >
      <Breadcrumbs items={["Dashboard", "Maintenance"]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard label="Open Requests" value="—" icon={ClipboardList} accentColor={ACCENT} />
        <GlassCard label="Due This Week" value="—" icon={CalendarClock} accentColor="#f59e0b" />
        <GlassCard label="Completed" value="—" icon={CheckCircle2} accentColor="#22c55e" />
        <GlassCard label="Overdue" value="—" icon={Wrench} accentColor="#ef4444" />
      </div>

      <GlassSection title="Quick Actions" icon={Wrench} accentColor={ACCENT}>
        <button
          onClick={() => navigate("/maintenance/directory")}
          className="w-full flex items-center gap-3 rounded-xl border border-border bg-muted/10 hover:bg-muted/20 transition-colors px-4 py-3.5 text-left"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
          >
            <Users size={16} style={{ color: ACCENT }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Customer Directory</p>
            <p className="text-xs text-muted-foreground">
              Confirmed CRM bookings — view profiles and apply maintenance charges.
            </p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </button>

        <button
          onClick={() => navigate("/maintenance/bills")}
          className="w-full flex items-center gap-3 rounded-xl border border-border bg-muted/10 hover:bg-muted/20 transition-colors px-4 py-3.5 text-left mt-2"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
          >
            <Receipt size={16} style={{ color: ACCENT }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Bills</p>
            <p className="text-xs text-muted-foreground">
              Create and manage maintenance bills for customers/units.
            </p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </button>
      </GlassSection>
    </MaintenanceShell>
  );
}
