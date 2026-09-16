import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Calculator, Lock1, Eye } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { getEmployeeCompanyOptions } from "@/api/employeeMasterApi";
import {
  getPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  processPayrollRun,
  lockPayrollRun,
  type PayrollRunStatus,
} from "@/api/payrollRunApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const inputBase =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelBase = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";

const statusBadge = (status: PayrollRunStatus) => {
  const styles: Record<PayrollRunStatus, string> = {
    Draft: "bg-muted text-muted-foreground border-border",
    Processed: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Locked: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles[status]}`}>
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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading payroll runs...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Payroll Run.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run"]} />
      <HrPayrollShell title="Payroll Run" subtitle="Compute, review, and lock monthly payroll" icon={Calculator}>
        <div className="space-y-5">
          {rights.canCreate && (
            <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border bg-muted/20">
                <h2 className="font-heading font-semibold text-foreground text-sm">New Payroll Run</h2>
              </div>
              <div className="p-5 flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelBase}>Company</label>
                  <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputBase} style={{ width: 200 }}>
                    <option value="">All Companies</option>
                    {companyOptions.map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelBase}>Month</label>
                  <select value={periodMonth} onChange={(e) => setPeriodMonth(Number(e.target.value))} className={inputBase} style={{ width: 150 }}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelBase}>Year</label>
                  <input type="number" value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className={inputBase} style={{ width: 100 }} />
                </div>
                <button onClick={handleCreate} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40">
                  Create Run
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60">
              <h3 className="font-heading font-semibold text-foreground text-sm">Payroll Runs</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">{runs.length} run{runs.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/10">
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Period</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Company</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Employees</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No payroll runs yet. Create one above.</td></tr>
                  ) : (
                    runs.map((r) => (
                      <tr key={r.PayrollRunId} className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer ${selectedRunId === r.PayrollRunId ? "bg-primary/5" : ""}`} onClick={() => setSelectedRunId(r.PayrollRunId)}>
                        <td className="px-4 py-2.5 font-medium text-foreground">{MONTHS[r.PeriodMonth - 1]} {r.PeriodYear}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.CompanyName || "All Companies"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.EmployeeCount}</td>
                        <td className="px-4 py-2.5">{statusBadge(r.Status)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {rights.canEdit && r.Status !== "Locked" && (
                              <button onClick={(e) => { e.stopPropagation(); handleProcess(r.PayrollRunId); }} disabled={busy} title="Process" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40">
                                <Calculator size={14} />
                              </button>
                            )}
                            {rights.canEdit && r.Status === "Processed" && (
                              <button onClick={(e) => { e.stopPropagation(); handleLock(r.PayrollRunId); }} disabled={busy} title="Lock" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-emerald-600 disabled:opacity-40">
                                <Lock1 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {detail && (
            <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60 flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-semibold text-foreground text-sm">
                    {MONTHS[detail.PeriodMonth - 1]} {detail.PeriodYear} — {detail.CompanyName || "All Companies"}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{detail.Employees.length} employee(s) computed</p>
                </div>
                {statusBadge(detail.Status)}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/10">
                      <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Employee</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Structure</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Gross</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Deduction</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Net</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">CTC</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.Employees.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Not processed yet. Click Process above.</td></tr>
                    ) : (
                      detail.Employees.map((e) => (
                        <tr key={e.PayrollRunEmployeeId} className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">{e.EmployeeName} <span className="text-muted-foreground font-mono text-xs">({e.EmployeeCode})</span></td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.SalaryStructureName || "-"}</td>
                          <td className="px-4 py-2.5 text-right font-mono">₹{e.GrossSalary.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right font-mono">₹{e.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right font-mono">₹{e.NetSalary.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right font-mono">₹{e.TotalCTC.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => navigate(`/hr-payroll/payroll-run/${detail.PayrollRunId}/payslip/${e.EmployeeId}`)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                            >
                              <Eye size={12} /> View
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
