import React from "react";
import { Profile2User, Calendar1, Wallet3 } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT as ACCENT } from "@/components/hrpayroll/HrPayrollShell";
import { GlassSection } from "@/components/dashboard/GlassShell";

// New module — shell only for now. Employees / Attendance / Payroll Run
// pages land here as they're built; this dashboard is just the entry point
// so the module has somewhere real to go from the strip/sidebar.
export default function HrPayrollDashboard() {
  usePageRights("hr-payroll-dashboard");

  const upcoming = [
    { icon: Profile2User, label: "Employee Master", desc: "Directory, roles & reporting lines" },
    { icon: Calendar1, label: "Attendance", desc: "Daily attendance & leave tracking" },
    { icon: Wallet3, label: "Payroll Run", desc: "Salary structures, runs & payslips" },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR and Payroll" }]} />
      <HrPayrollShell title="HR and Payroll" subtitle="Employees, attendance & payroll — coming soon" icon={Profile2User}>
        <GlassSection title="What's coming" icon={Profile2User} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {upcoming.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/60 bg-card/60 p-4 flex flex-col gap-2"
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
                >
                  <item.icon size={16} style={{ color: ACCENT }} />
                </div>
                <p className="text-sm font-heading font-semibold text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            This module has just been added to the app — Employee Master, Attendance
            and Payroll Run will be built out here next.
          </p>
        </GlassSection>
      </HrPayrollShell>
    </>
  );
}
