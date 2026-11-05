import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Calculator, Lock1, Eye } from "iconsax-react";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT, HR_GRADIENT } from "@/components/hrpayroll/HrPayrollShell";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { getEmployeeCompanyOptions } from "@/api/employeeMasterApi";
import {
  getPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  processPayrollRun,
  lockPayrollRun,
  deletePayrollRun,
  type PayrollRunStatus,
} from "@/api/payrollRunApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const inputBase =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelBase = "block text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";

const statusBadge = (status: PayrollRunStatus) => {
  const styles: Record<PayrollRunStatus, string> = {
    Draft: "bg-muted text-muted-foreground border-border",
    Processed: "bg-[#ffe2021a] text-amber-600 border-amber-500/30",
    Locked: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-medium border ${styles[status]}`}>
      {status}
    </span>
  );
};

// Payroll Run -- functional table-based UI (kept simpler than Salary
// Structure Master by design): create a run for a Company + Month/Year,
// Process it (computes every eligible employee's salary via the same
// formula engine Salary Structure's Preview uses), then Lock it to freeze
// the snapshot (spec 13/15).
const PayrollRun: React.FC = () => {
  const rights = usePageRights("payroll-run");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({ queryKey: ["payroll-run"], queryFn: getPayrollRuns, staleTime: 30 * 1000 });
  const { data: companyData } = useQuery({ queryKey: ["employee-company-options"], queryFn: getEmployeeCompanyOptions, staleTime: 5 * 60 * 1000 });

  const runs = Array.isArray(data) ? data : [];
  const companyOptions = Array.isArray(companyData) ? companyData : [];

  const now = new Date();
  const [companyId, setCompanyId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payroll-run"] });

  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["payroll-run-detail", selectedRunId],
    queryFn: () => getPayrollRun(selectedRunId as number),
    enabled: selectedRunId !== null,
  });

  const handleCreate = async () => {
    setBusy(true);
    try {
      const res = await createPayrollRun({ CompanyId: companyId ? Number(companyId) : null, PeriodMonth: periodMonth, PeriodYear: periodYear });
      toast.success("Payroll run created ✓");
      setSelectedRunId(res.id);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create payroll run");
    } finally {
      setBusy(false);
    }
  };

  const handleProcess = async (id: number) => {
    setBusy(true);
    try {
      const res = await processPayrollRun(id);
      toast.success(res.message);
      if (res.skipped.length) {
        res.skipped.forEach((s) => toast.error(`${s.EmployeeName}: ${s.reason}`));
      }
      await refresh();
      await refetchDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process payroll run");
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async (id: number) => {
    setBusy(true);
    try {
      await lockPayrollRun(id);
      toast.success("Payroll run locked ✓");
      await refresh();
      await refetchDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to lock payroll run");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    setBusy(true);
    try {
      const res = await deletePayrollRun(id);
      toast.success(res?.message || "Payroll run deleted");
      setDeleteConfirmId(null);
      if (selectedRunId === id) setSelectedRunId(null);
      await refresh();
    } catch (err) {
      setDeleteConfirmId(null);
      toast.error(err instanceof Error ? err.message : "Failed to delete payroll run");
    } finally {
      setBusy(false);
    }
  };

  // ── Display-only derived numbers (no new requests) ─────────────────────
  const counts = {
    total: runs.length,
    draft: runs.filter((r) => r.Status === "Draft").length,
    processed: runs.filter((r) => r.Status === "Processed").length,
    locked: runs.filter((r) => r.Status === "Locked").length,
  };
  const totals = detail
    ? detail.Employees.reduce(
        (t, e) => ({
          gross: t.gross + (e.GrossSalary || 0),
          ded: t.ded + (e.TotalEmployeeDeduction || 0),
          net: t.net + (e.NetSalary || 0),
          ctc: t.ctc + (e.TotalCTC || 0),
        }),
        { gross: 0, ded: 0, net: 0, ctc: 0 },
      )
    : null;
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const stepOf = (st: PayrollRunStatus) => (st === "Draft" ? 1 : st === "Processed" ? 2 : 3);

  if (isLoading) {
    return (
      <div className="space-y-4 p-1">
        <div className="h-28 rounded-2xl bg-muted/60 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((k) => <div key={k} className="h-20 rounded-2xl bg-muted/50 animate-pulse" />)}</div>
        <div className="h-64 rounded-2xl bg-muted/40 animate-pulse" />
      </div>
    );
  }
  if (error) return <div className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">Failed to load Payroll Run.</div>;

  const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run"]} />
      <HrPayrollShell title="Payroll Run" subtitle="Compute, review, and lock monthly payroll" icon={Calculator}>
        <div className="space-y-5">
          {/* ── How a run works: Create → Process → Lock (soft tint, not a heavy colour block) ── */}
          <div className="rounded-2xl border p-4 sm:p-5" style={{ background: `${HR_PAYROLL_ACCENT}0d`, borderColor: `${HR_PAYROLL_ACCENT}33` }}>
            <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Monthly payroll in three steps</p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                ["1", "Create", "Pick the company and month"],
                ["2", "Process", "Compute every employee's salary"],
                ["3", "Lock", "Freeze the payslips for the month"],
              ] as const).map(([n, t, d]) => (
                <div key={n} className="flex items-center gap-3 rounded-xl border border-border bg-card/80 px-3.5 py-3 shadow-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: HR_GRADIENT }}>{n}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-heading font-semibold leading-tight text-foreground">{t}</p>
                    <p className="text-[0.6875rem] text-muted-foreground truncate">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── At a glance ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ["Total runs", counts.total, HR_PAYROLL_ACCENT],
              ["Draft", counts.draft, "#64748b"],
              ["Processed", counts.processed, "#f59e0b"],
              ["Locked", counts.locked, "#10b981"],
            ] as const).map(([label, n, c]) => (
              <div key={label} className={`${card} px-4 py-3.5`}>
                <div className="flex items-center justify-between">
                  <p className="text-[0.6875rem] font-heading uppercase tracking-wider text-muted-foreground">{label}</p>
                  <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                </div>
                <p className="mt-1 text-2xl font-heading font-bold tabular-nums" style={{ color: c }}>{n}</p>
              </div>
            ))}
          </div>

          {/* ── Create ── */}
          {rights.canCreate && (
            <div className={card}>
              <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: HR_GRADIENT }}><Calculator size={15} /></span>
                <div>
                  <h2 className="font-heading font-semibold text-foreground text-sm">New Payroll Run</h2>
                  <p className="text-[0.6875rem] text-muted-foreground">Choose who and when — you can process it right after.</p>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-4 items-end">
                <div className="min-w-0">
                  <label className={labelBase}>Company</label>
                  <SearchableNativeSelect value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputBase} searchPlaceholder="Search company…">
                    <option value="">All Companies</option>
                    {companyOptions.map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
                  </SearchableNativeSelect>
                </div>
                <div className="min-w-0">
                  <label className={labelBase}>Month</label>
                  <select value={periodMonth} onChange={(e) => setPeriodMonth(Number(e.target.value))} className={inputBase}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelBase}>Year</label>
                  <div className="flex items-center rounded-lg border border-border bg-muted overflow-hidden">
                    <button type="button" onClick={() => setPeriodYear((y) => y - 1)} className="px-3 py-2 text-muted-foreground hover:bg-background hover:text-foreground">−</button>
                    <input type="number" value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className="w-16 bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none" />
                    <button type="button" onClick={() => setPeriodYear((y) => y + 1)} className="px-3 py-2 text-muted-foreground hover:bg-background hover:text-foreground">+</button>
                  </div>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={busy}
                  className="h-10 px-6 rounded-lg text-sm font-heading font-semibold text-white shadow-md transition-transform hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:hover:translate-y-0"
                  style={{ background: HR_GRADIENT }}
                >
                  {busy ? "Working…" : `Create ${MONTHS[periodMonth - 1].slice(0, 3)} ${periodYear} run`}
                </button>
              </div>
            </div>
          )}

          {/* ── Runs ── */}
          <div className={card}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-heading font-semibold text-foreground text-sm">Payroll Runs</h3>
                <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{runs.length} run{runs.length !== 1 ? "s" : ""} · click one to see its employees</p>
              </div>
            </div>
            {runs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: HR_GRADIENT }}><Calculator size={22} /></span>
                <p className="text-sm font-semibold text-foreground">No payroll runs yet</p>
                <p className="text-xs text-muted-foreground max-w-xs">{rights.canCreate ? "Create your first run above — pick the company and the month." : "Runs created by payroll staff will appear here."}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {runs.map((r) => {
                  const step = stepOf(r.Status);
                  const selected = selectedRunId === r.PayrollRunId;
                  return (
                    <div
                      key={r.PayrollRunId}
                      onClick={() => setSelectedRunId(r.PayrollRunId)}
                      className={`group flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 cursor-pointer transition-colors ${selected ? "bg-fuchsia-600/[0.07]" : "hover:bg-muted/30"}`}
                      style={selected ? { boxShadow: `inset 3px 0 0 ${HR_PAYROLL_ACCENT}` } : undefined}
                    >
                      {/* Month tile */}
                      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-white shadow-sm" style={{ background: HR_GRADIENT }}>
                        <span className="text-[0.625rem] font-semibold uppercase leading-none opacity-85">{MONTHS[r.PeriodMonth - 1].slice(0, 3)}</span>
                        <span className="text-sm font-bold leading-tight">{String(r.PeriodYear).slice(2)}</span>
                      </div>
                      <div className="min-w-[10rem] flex-1">
                        <p className="font-heading font-semibold text-foreground">{MONTHS[r.PeriodMonth - 1]} {r.PeriodYear}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.CompanyName || "All Companies"} · {r.EmployeeCount} employee{r.EmployeeCount === 1 ? "" : "s"}</p>
                      </div>
                      {/* Progress through Create → Process → Lock */}
                      <div className="hidden md:flex items-center gap-1.5" title={`Step ${step} of 3`}>
                        {[1, 2, 3].map((k) => (
                          <span key={k} className="h-1.5 w-8 rounded-full" style={{ background: k <= step ? HR_GRADIENT : "hsl(var(--muted))" }} />
                        ))}
                      </div>
                      <div className="w-24">{statusBadge(r.Status)}</div>
                      <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button data-row-view="hide" onClick={() => setSelectedRunId(r.PayrollRunId)} title="View Records" className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                          <Eye size={15} />
                        </button>
                        {rights.canEdit && r.Status !== "Locked" && (
                          <button onClick={() => handleProcess(r.PayrollRunId)} disabled={busy} title="Process" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-40">
                            <Calculator size={13} /> Process
                          </button>
                        )}
                        {rights.canEdit && r.Status === "Processed" && (
                          <button onClick={() => handleLock(r.PayrollRunId)} disabled={busy} title="Lock" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors disabled:opacity-40">
                            <Lock1 size={13} /> Lock
                          </button>
                        )}
                        {rights.canDelete && (
                          deleteConfirmId === r.PayrollRunId ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDelete(r.PayrollRunId)} disabled={busy} className="px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-medium bg-destructive text-destructive-foreground disabled:opacity-40">Confirm</button>
                              <button onClick={() => setDeleteConfirmId(null)} className="px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-medium border border-border">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(r.PayrollRunId)} title="Delete" className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                              <Trash2 size={14} />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Selected run ── */}
          {detail && (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
                <div className="min-w-0">
                  <h3 className="font-heading font-semibold text-foreground">
                    {MONTHS[detail.PeriodMonth - 1]} {detail.PeriodYear} <span className="text-muted-foreground font-normal">— {detail.CompanyName || "All Companies"}</span>
                  </h3>
                  <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{detail.Employees.length} employee(s) computed</p>
                </div>
                {statusBadge(detail.Status)}
              </div>
              {totals && detail.Employees.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border/60 border-b border-border">
                  {([
                    ["Gross", totals.gross, "text-foreground"],
                    ["Deductions", totals.ded, "text-rose-500"],
                    ["Net pay", totals.net, "text-emerald-600 dark:text-emerald-400"],
                    ["Total CTC", totals.ctc, "text-fuchsia-700 dark:text-fuchsia-300"],
                  ] as const).map(([l, v, c]) => (
                    <div key={l} className="bg-card px-5 py-3">
                      <p className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">{l}</p>
                      <p className={`mt-0.5 text-lg font-heading font-bold tabular-nums ${c}`}>{inr(v)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-5 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Employee</th>
                      <th className="text-left px-4 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Structure</th>
                      <th className="text-right px-4 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Gross</th>
                      <th className="text-right px-4 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Deduction</th>
                      <th className="text-right px-4 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Net</th>
                      <th className="text-right px-4 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">CTC</th>
                      <th className="text-right px-5 py-2.5 text-[0.625rem] font-heading uppercase tracking-widest text-muted-foreground">Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.Employees.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">Not processed yet — use <b>Process</b> on this run above.</td></tr>
                    ) : (
                      detail.Employees.map((e) => (
                        <tr key={e.PayrollRunEmployeeId} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20 transition-colors">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold text-white" style={{ background: HR_GRADIENT }}>
                                {(e.EmployeeName || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate">{e.EmployeeName}</p>
                                <p className="text-muted-foreground font-mono text-[0.6875rem]">{e.EmployeeCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.SalaryStructureName || "-"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">₹{e.GrossSalary.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-rose-500">₹{e.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">₹{e.NetSalary.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">₹{e.TotalCTC.toLocaleString("en-IN")}</td>
                          <td className="px-5 py-2.5 text-right">
                            <button data-row-view
                              onClick={() => navigate(`/hr-payroll/payroll-run/${detail.PayrollRunId}/payslip/${e.EmployeeId}`)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-white shadow-sm hover:shadow-md transition-shadow"
                              style={{ background: HR_GRADIENT }}
                            >
                              <Eye size={12} /> Payslip
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </HrPayrollShell>
    </>
  );
};

export default PayrollRun;
