import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Skel, SheetMark, share } from "@/components/sheet/Sheet";
import { getEmployees, type EmployeeRow } from "@/api/employeeMasterApi";
import { getPayrollRuns, type PayrollRunRow } from "@/api/payrollRunApi";

// HR & Payroll overview, drawn like the other module dashboards: a title block, then lettered sections of figures,
// what needs doing, how the team is made up, the payroll runs and every page of the module. Read from the same
// employee and payroll-run lists (and cache keys) Employee Master and Payroll Run use.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Every page of the module (same routes as the HR & Payroll sidebar and its Setup menu).
const PAGES: { group: string; items: { label: string; path: string }[] }[] = [
  {
    group: "Payroll",
    items: [
      { label: "Employee master", path: "/hr-payroll/employees" },
      { label: "Attendance", path: "/hr-payroll/attendance" },
      { label: "Attendance / leave / overtime", path: "/hr-payroll/attendance-leave-overtime" },
      { label: "Salary calculation", path: "/hr-payroll/salary-calculation" },
      { label: "Incentive", path: "/hr-payroll/incentive" },
      { label: "Payroll run", path: "/hr-payroll/payroll-run" },
    ],
  },
  {
    group: "HR",
    items: [
      { label: "Interview", path: "/hr-payroll/interviews" },
      { label: "Offer letter & joining", path: "/hr-payroll/offer-letter-joining" },
      { label: "HR attendance management", path: "/hr-payroll/hr-attendance" },
    ],
  },
  {
    group: "Setup",
    items: [
      { label: "Salary structure", path: "/hr-payroll/setup/salary-structure" },
      { label: "Designation master", path: "/hr-payroll/setup/designation-master" },
      { label: "Candidate master", path: "/hr-payroll/setup/candidate-master" },
      { label: "Shift master", path: "/hr-payroll/setup/shift-master" },
      { label: "Grace time master", path: "/hr-payroll/setup/grace-time-master" },
      { label: "Holiday master", path: "/hr-payroll/setup/holiday-master" },
      { label: "Deduction & addition master", path: "/hr-payroll/setup/deduction-addition-master" },
    ],
  },
];

const fmtNum = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const blank = (v?: string | null) => !v || !String(v).trim();
const annualCtc = (e: EmployeeRow) => (Number(e.CTCAmount) || 0) * (e.CTCFrequency === "Monthly" ? 12 : 1);
const runTone = (s: string) => (s === "Locked" ? "done" : s === "Processed" ? "moving" : "draft") as "done" | "moving" | "draft";
const empty = (text: string) => <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{text}</p>;

/** One line per group, a bar measured on the largest group, its share of the whole on the right. */
function Bars({ rows, total, emptyText }: { rows: [string, number][]; total: number; emptyText: string }) {
  if (!rows.length) return empty(emptyText);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div>
      {rows.map(([name, n]) => (
        <div key={name} style={{ padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span className="label" style={{ color: "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
              {Math.round(share(n, total))}% <span className="figure" style={{ fontSize: 15, color: "var(--ink)", marginLeft: 8 }}>{fmtNum(n)}</span>
            </span>
          </span>
          <span style={{ display: "block", height: 9, marginTop: 7, width: `${share(n, max)}%`, minWidth: 2, border: "1px solid var(--ink)" }}>
            <span className="grow" style={{ display: "block", height: "100%", width: "100%", background: "var(--blue)" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Joiners per month for the last twelve months, as columns. */
function JoinerColumns({ months }: { months: { label: string; n: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.n));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, alignItems: "end", gap: 6, height: 150, borderBottom: "1px solid var(--ink)" }}>
        {months.map((m) => (
          <div key={m.label} title={`${m.label}: ${m.n}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <span className="figure" style={{ fontSize: 11, color: m.n ? "var(--ink)" : "var(--graphite)", marginBottom: 4 }}>{m.n || ""}</span>
            <span className={m.n ? "" : "hatch"} style={{ display: "block", width: "100%", maxWidth: 34, height: `${Math.max(2, (m.n / max) * 118)}px`, background: m.n ? "var(--blue)" : undefined, border: "1px solid var(--ink)", borderBottom: 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, gap: 6, marginTop: 6 }}>
        {months.map((m) => <span key={m.label} className="label" style={{ textAlign: "center", fontSize: 9 }}>{m.label}</span>)}
      </div>
    </div>
  );
}

export default function HrPayrollDashboard() {
  usePageRights("hr-payroll-dashboard");
  const navigate = useNavigate();

  const emp = useQuery({ queryKey: ["employee-master"], queryFn: getEmployees, staleTime: 60 * 1000 });
  const run = useQuery({ queryKey: ["payroll-run"], queryFn: getPayrollRuns, staleTime: 30 * 1000 });
  const employees: EmployeeRow[] = Array.isArray(emp.data) ? emp.data : [];
  const runs: PayrollRunRow[] = Array.isArray(run.data) ? run.data : [];
  const loading = emp.isLoading || run.isLoading;
  const fetching = emp.isFetching || run.isFetching;
  const readAt = new Date(Math.max(emp.dataUpdatedAt || 0, run.dataUpdatedAt || 0) || Date.now());
  const reread = () => { void emp.refetch(); void run.refetch(); };

  const s = useMemo(() => {
    const now = new Date();
    const active = employees.filter((e) => e.IsActive !== false);
    const inMonth = (iso: string | null, y: number, m: number) => { if (!iso) return false; const d = new Date(iso); return d.getFullYear() === y && d.getMonth() === m; };
    const in30 = (iso: string | null) => { if (!iso) return false; const t = new Date(iso).getTime() - now.getTime(); return t >= 0 && t <= 30 * 864e5; };

    const group = (key: (e: EmployeeRow) => string | null) => {
      const m = new Map<string, number>();
      for (const e of active) { const k = (key(e) || "").trim() || "Not set"; m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };

    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { label: MONTHS[d.getMonth()], n: employees.filter((e) => inMonth(e.JoiningDate, d.getFullYear(), d.getMonth())).length };
    });

    const sortedRuns = [...runs].sort((a, b) => b.PeriodYear * 12 + b.PeriodMonth - (a.PeriodYear * 12 + a.PeriodMonth));
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthRuns = runs.filter((r) => r.PeriodYear === last.getFullYear() && r.PeriodMonth === last.getMonth() + 1);
    const ctc = active.reduce((t, e) => t + annualCtc(e), 0);
    const withCtc = active.filter((e) => annualCtc(e) > 0).length;

    return {
      total: employees.length,
      active: active.length,
      inactive: employees.length - active.length,
      joinedThisMonth: employees.filter((e) => inMonth(e.JoiningDate, now.getFullYear(), now.getMonth())).length,
      joined12: months.reduce((t, m) => t + m.n, 0),
      months,
      ctc,
      avgCtc: withCtc ? ctc / withCtc : 0,
      noStructure: active.filter((e) => blank(e.SalaryStructureCode)),
      noBank: active.filter((e) => blank(e.BankAccountNumber) || blank(e.BankIFSC)),
      noPan: active.filter((e) => blank(e.PAN)),
      noUan: active.filter((e) => blank(e.UAN)),
      noDocs: active.filter((e) => !Number(e.DocumentCount)),
      confirmSoon: active.filter((e) => in30(e.ConfirmationDate)),
      birthdays: active.filter((e) => e.DateOfBirth && new Date(e.DateOfBirth).getMonth() === now.getMonth()),
      byDept: group((e) => e.Department),
      byType: group((e) => e.EmploymentType),
      byCompany: group((e) => e.CompanyName),
      runs: sortedRuns.slice(0, 12),
      latest: sortedRuns[0] ?? null,
      locked: runs.filter((r) => r.Status === "Locked").length,
      last,
      lastMonthRuns,
    };
  }, [employees, runs]);

  const lastName = `${MONTHS_LONG[s.last.getMonth()]} ${s.last.getFullYear()}`;
  const figures: { path: string; label: string; value: string; sub: string; warn?: boolean }[] = [
    { path: "/hr-payroll/employees", label: "Active employees", value: fmtNum(s.active), sub: `${fmtNum(s.total)} on the roll · ${fmtNum(s.inactive)} inactive` },
    { path: "/hr-payroll/employees", label: "Joined this month", value: fmtNum(s.joinedThisMonth), sub: `${fmtNum(s.joined12)} in the last twelve months` },
    { path: "/hr-payroll/employees", label: "Annual CTC on the roll", value: fmtMoney(s.ctc), sub: s.avgCtc ? `about ${fmtMoney(s.avgCtc)} a person` : "no CTC entered yet" },
    { path: "/hr-payroll/payroll-run", label: "Latest payroll", value: s.latest ? `${MONTHS[s.latest.PeriodMonth - 1]} ${s.latest.PeriodYear}` : "None", sub: s.latest ? `${s.latest.Status} · ${fmtNum(s.latest.EmployeeCount)} employees` : "start one from Payroll Run" },
    { path: "/hr-payroll/employees", label: "Without a salary structure", value: fmtNum(s.noStructure.length), sub: "active employees payroll can't compute", warn: s.noStructure.length > 0 },
    { path: "/hr-payroll/employees", label: "Bank details missing", value: fmtNum(s.noBank.length), sub: "account number or IFSC not entered", warn: s.noBank.length > 0 },
    { path: "/hr-payroll/employees", label: "PAN missing", value: fmtNum(s.noPan.length), sub: `${fmtNum(s.noUan.length)} without a UAN`, warn: s.noPan.length > 0 },
    { path: "/hr-payroll/employees", label: "Confirmations due", value: fmtNum(s.confirmSoon.length), sub: "in the next 30 days" },
  ];

  const names = (list: EmployeeRow[]) => list.slice(0, 3).map((e) => e.EmployeeName).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
  const attention: { path: string; text: string }[] = loading ? [] : ([
    s.lastMonthRuns.length === 0 && s.active > 0 && { path: "/hr-payroll/payroll-run", text: `No payroll run has been created for ${lastName}.` },
    s.lastMonthRuns.some((r) => r.Status !== "Locked") && { path: "/hr-payroll/payroll-run", text: `${lastName}'s payroll is ${s.lastMonthRuns.find((r) => r.Status !== "Locked")?.Status.toLowerCase()}, not locked yet.` },
    s.noStructure.length > 0 && { path: "/hr-payroll/employees", text: `${fmtNum(s.noStructure.length)} active ${s.noStructure.length === 1 ? "employee has" : "employees have"} no salary structure: ${names(s.noStructure)}.` },
    s.noBank.length > 0 && { path: "/hr-payroll/employees", text: `${fmtNum(s.noBank.length)} active ${s.noBank.length === 1 ? "employee has" : "employees have"} no bank account or IFSC, so salary can't be paid to them.` },
    s.noPan.length > 0 && { path: "/hr-payroll/employees", text: `${fmtNum(s.noPan.length)} active ${s.noPan.length === 1 ? "employee has" : "employees have"} no PAN.` },
    s.noDocs.length > 0 && { path: "/hr-payroll/employees", text: `${fmtNum(s.noDocs.length)} active ${s.noDocs.length === 1 ? "employee has" : "employees have"} no documents uploaded.` },
    s.confirmSoon.length > 0 && { path: "/hr-payroll/employees", text: `${fmtNum(s.confirmSoon.length)} ${s.confirmSoon.length === 1 ? "confirmation falls" : "confirmations fall"} due in the next 30 days: ${names(s.confirmSoon)}.` },
  ].filter(Boolean) as { path: string; text: string }[]);

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR and Payroll" }]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · HR & Payroll</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>People and payroll</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Who is on the roll and what they cost, what is missing before payroll can run cleanly, how the team is made up and where each month's payroll stands.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Date</span>
              {readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={reread} disabled={fetching} className="label link" style={{ color: "var(--blue)" }}>
                {fetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {(emp.isError || run.isError) && !loading && (
          <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>
            Could not load {emp.isError ? "the employee list" : "the payroll runs"}. Use Re-read to try again.
          </div>
        )}

        {/* A — figures */}
        <Detail tag="A" title="Right now" note="Open a figure for its page">
          {loading ? (
            <div className="grid4" style={{ gap: 16 }}>{Array.from({ length: 8 }).map((_, i) => <Skel key={i} h={58} />)}</div>
          ) : (
            <div className="grid4" style={{ rowGap: 22, columnGap: 24 }}>
              {figures.map((f) => (
                <button key={f.label} onClick={() => navigate(f.path)} style={{ textAlign: "left", minWidth: 0 }}>
                  <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>{f.label}</span>
                  <span className="figure" style={{ display: "block", fontSize: "clamp(22px, 2.4vw, 32px)", color: f.warn ? "var(--red)" : undefined }}>{f.value}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{f.sub}</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* B — what needs doing */}
        <Detail tag="B" title="Needs attention">
          {loading ? (<><Skel h={22} /><Skel h={22} /></>) : attention.length === 0 ? empty("Nothing is waiting: last month's payroll is locked and every active employee has a salary structure, bank details, PAN and documents.") : (
            <div>
              {attention.map((a) => (
                <button key={a.text} onClick={() => navigate(a.path)} className="row"
                  style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--rule-soft)", textAlign: "left" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink)", minWidth: 0 }}>
                    <i style={{ width: 8, height: 8, flexShrink: 0, background: "var(--red)" }} />
                    {a.text}
                  </span>
                  <span style={{ color: "var(--graphite)", fontSize: 13 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* C + D */}
        <div className="grid2">
          <Detail tag="C" title="Team by department" note={s.byDept.length > 8 ? "Largest eight" : `${fmtNum(s.active)} active`}>
            {loading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : <Bars rows={s.byDept.slice(0, 8)} total={s.active} emptyText="No active employees yet." />}
          </Detail>
          <Detail tag="D" title="Payroll runs" note={`${fmtNum(s.locked)} locked in all`}>
            {loading ? (<><Skel h={26} /><Skel h={26} /></>) : s.runs.length === 0 ? empty("No payroll run yet. Create one from Payroll Run.") : (
              <div>
                {s.runs.map((r) => (
                  <button key={r.PayrollRunId} onClick={() => navigate("/hr-payroll/payroll-run")} className="row"
                    style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", textAlign: "left" }}>
                    <span className="label" style={{ color: "var(--ink)", width: 74, flexShrink: 0 }}>{MONTHS[r.PeriodMonth - 1]} {r.PeriodYear}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.CompanyName || "All companies"}</span>
                    <SheetMark text={r.Status} tone={runTone(r.Status)} />
                    <span className="figure" style={{ fontSize: 15, minWidth: 44, textAlign: "right" }}>{fmtNum(r.EmployeeCount)}</span>
                  </button>
                ))}
                <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>Employees paid in each run · the latest twelve</p>
              </div>
            )}
          </Detail>
        </div>

        {/* E — joiners */}
        <Detail tag="E" title="Twelve months of joiners" note={`${fmtNum(s.joined12)} joined`}>
          {loading ? <Skel h={180} /> : s.joined12 === 0 ? empty("Nobody has joined in the last twelve months.") : <JoinerColumns months={s.months} />}
        </Detail>

        {/* F + G */}
        <div className="grid2">
          <Detail tag="F" title="By employment type">
            {loading ? (<><Skel h={26} /><Skel h={26} /></>) : <Bars rows={s.byType.slice(0, 8)} total={s.active} emptyText="No active employees yet." />}
          </Detail>
          <Detail tag="G" title="By company" note={s.birthdays.length ? `${fmtNum(s.birthdays.length)} ${s.birthdays.length === 1 ? "birthday" : "birthdays"} this month` : undefined}>
            {loading ? (<><Skel h={26} /><Skel h={26} /></>) : <Bars rows={s.byCompany.slice(0, 8)} total={s.active} emptyText="No active employees yet." />}
          </Detail>
        </div>

        {/* H — every page */}
        <Detail tag="H" title="Go to">
          <div style={{ display: "grid", gap: 18 }}>
            {PAGES.map((g) => (
              <div key={g.group}>
                <p className="label" style={{ margin: "0 0 4px" }}>{g.group}</p>
                <div className="grid4" style={{ gap: 0 }}>
                  {g.items.map((it) => (
                    <button key={it.path} onClick={() => navigate(it.path)} className="row"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 10px", borderBottom: "1px solid var(--rule-soft)" }}>
                      <span className="label link" style={{ color: "var(--ink)" }}>{it.label}</span>
                      <span style={{ color: "var(--graphite)", fontSize: 13 }}>→</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Detail>
      </div>
    </div>
  );
}
