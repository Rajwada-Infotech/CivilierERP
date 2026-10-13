import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Profile2User, Calendar1, Wallet3, Calculator, Briefcase, TaskSquare, UserTick, Gift, Timer1, ReceiptText,
} from "iconsax-react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT as ACCENT, HR_GRADIENT } from "@/components/hrpayroll/HrPayrollShell";
import { getEmployees } from "@/api/employeeMasterApi";
import { getPayrollRuns } from "@/api/payrollRunApi";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Every page of the module (same routes as the HR & Payroll sidebar), grouped the same way.
const GROUPS: { title: string; items: { icon: React.ElementType; label: string; desc: string; path: string }[] }[] = [
  {
    title: "Payroll",
    items: [
      { icon: Profile2User, label: "Employee Master", desc: "Directory, roles & documents", path: "/hr-payroll/employees" },
      { icon: ReceiptText, label: "Salary Structure", desc: "Earnings & deduction formulas", path: "/hr-payroll/setup/salary-structure" },
      { icon: Calendar1, label: "Attendance", desc: "Daily attendance", path: "/hr-payroll/attendance" },
      { icon: Timer1, label: "Attendance / Leave / Overtime", desc: "Leave & overtime records", path: "/hr-payroll/attendance-leave-overtime" },
      { icon: Calculator, label: "Salary Calculation", desc: "Preview an employee's salary", path: "/hr-payroll/salary-calculation" },
      { icon: Gift, label: "Incentive", desc: "Bonuses & incentives", path: "/hr-payroll/incentive" },
      { icon: Wallet3, label: "Payroll Run", desc: "Create, process & lock payroll", path: "/hr-payroll/payroll-run" },
    ],
  },
  {
    title: "HR",
    items: [
      { icon: Briefcase, label: "Interview", desc: "Candidates & interview rounds", path: "/hr-payroll/interviews" },
      { icon: TaskSquare, label: "Offer Letter & Joining", desc: "Offers and onboarding", path: "/hr-payroll/offer-letter-joining" },
      { icon: UserTick, label: "HR Attendance Management", desc: "Team attendance oversight", path: "/hr-payroll/hr-attendance" },
    ],
  },
];

export default function HrPayrollDashboard() {
  usePageRights("hr-payroll-dashboard");
  const navigate = useNavigate();

  // Same queries (and cache keys) as Employee Master / Payroll Run — read-only here.
  const { data: empData, isLoading: empLoading } = useQuery({ queryKey: ["employee-master"], queryFn: getEmployees, staleTime: 60 * 1000 });
  const { data: runData, isLoading: runLoading } = useQuery({ queryKey: ["payroll-run"], queryFn: getPayrollRuns, staleTime: 30 * 1000 });
  const employees = Array.isArray(empData) ? empData : [];
  const runs = Array.isArray(runData) ? runData : [];

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.IsActive !== false).length;
    const now = new Date();
    const joinedThisMonth = employees.filter((e) => {
      if (!e.JoiningDate) return false;
      const d = new Date(e.JoiningDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    const byDept = new Map<string, number>();
    for (const e of employees) if (e.IsActive !== false) byDept.set(e.Department || "Unassigned", (byDept.get(e.Department || "Unassigned") || 0) + 1);
    const departments = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
    const latest = [...runs].sort((a, b) => b.PeriodYear * 12 + b.PeriodMonth - (a.PeriodYear * 12 + a.PeriodMonth))[0] ?? null;
    return { total: employees.length, active, joinedThisMonth, departments, latest, locked: runs.filter((r) => r.Status === "Locked").length };
  }, [employees, runs]);

  const loading = empLoading || runLoading;
  const dash = (n: number | string) => (loading ? "—" : n);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR and Payroll" }]} />
      <HrPayrollShell title="HR and Payroll" subtitle="Employees, attendance & payroll" icon={Profile2User}>
        <div className="space-y-5">
          {/* ── Hero ── */}
          <div className="relative overflow-hidden rounded-2xl border p-5 sm:p-7" style={{ background: `${ACCENT}0d`, borderColor: `${ACCENT}33` }}>
            <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full blur-3xl" style={{ background: `${ACCENT}1f` }} />
            <div className="relative flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{greeting} 👋</p>
                <h2 className="mt-1 text-2xl sm:text-3xl font-heading font-bold leading-tight text-foreground">
                  {dash(stats.active)} active {stats.active === 1 ? "employee" : "employees"}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {stats.latest
                    ? <>Latest payroll: <b>{MONTHS[stats.latest.PeriodMonth - 1]} {stats.latest.PeriodYear}</b> · {stats.latest.Status}</>
                    : loading ? "Loading…" : "No payroll run yet — start one from Payroll Run."}
                </p>
              </div>
              <button
                onClick={() => navigate("/hr-payroll/payroll-run")}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-heading font-semibold text-white shadow-md transition-transform hover:-translate-y-0.5"
                style={{ background: HR_GRADIENT }}
              >
                <Wallet3 size={16} /> Go to Payroll Run <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {/* ── Stats ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ["Total employees", dash(stats.total), Profile2User],
              ["Active", dash(stats.active), UserTick],
              ["Joined this month", dash(stats.joinedThisMonth), Calendar1],
              ["Locked payroll runs", dash(stats.locked), Wallet3],
            ] as const).map(([label, value, Icon]) => (
              <div key={label} className={`${card} p-4 flex items-center gap-3`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: HR_GRADIENT }}>
                  <Icon size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-2xl font-heading font-bold tabular-nums leading-none text-foreground">{value}</p>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground truncate">{label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5">
            {/* ── Every page, grouped like the sidebar ── */}
            <div className="space-y-5 min-w-0">
              {GROUPS.map((g) => (
                <div key={g.title} className={`${card} p-4 sm:p-5`}>
                  <p className="mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">{g.title}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {g.items.map((it) => (
                      <button
                        key={it.path}
                        onClick={() => navigate(it.path)}
                        className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                        style={{ ["--tw-shadow-color" as string]: `${ACCENT}33` }}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT}1a`, color: ACCENT }}>
                          <it.icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground truncate">{it.label}</span>
                          <span className="block text-xs text-muted-foreground truncate">{it.desc}</span>
                        </span>
                        <ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Team by department ── */}
            <div className={`${card} p-4 sm:p-5 h-fit`}>
              <p className="mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Team by department</p>
              {loading ? (
                <div className="space-y-2.5">{[0, 1, 2, 3].map((k) => <div key={k} className="h-7 rounded-lg bg-muted/60 animate-pulse" />)}</div>
              ) : stats.departments.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No active employees yet.</p>
              ) : (
                <div className="space-y-3">
                  {stats.departments.slice(0, 8).map(([dept, n]) => (
                    <div key={dept}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-foreground truncate">{dept}</span>
                        <span className="tabular-nums text-muted-foreground">{n}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(n / stats.active) * 100}%`, background: HR_GRADIENT }} />
                      </div>
                    </div>
                  ))}
                  {stats.departments.length > 8 && <p className="text-[0.6875rem] text-muted-foreground">+{stats.departments.length - 8} more</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </HrPayrollShell>
    </>
  );
}
