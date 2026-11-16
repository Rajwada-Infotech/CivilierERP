import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Calculator, Lock1, Eye } from "iconsax-react";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrEmpty, HrError, HrSkeleton, HrStatStrip, hrCard, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED_SOLID, TONE } from "@/components/sheet/sheetParts";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
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

// Sheet fields and keys (docs/DESIGN.md).
const inputBase = HR_FIELD;
const labelBase = `block ${HR_LBL} mb-1.5`;
// Icon-only row action: a 7x7 square, outlined on hover.
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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
      toast.success("Payroll run created");
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
      toast.success("Payroll run locked");
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

  const runTone = (st: PayrollRunStatus): MarkTone => (st === "Locked" ? "done" : st === "Processed" ? "moving" : "draft");
  const TH = `${HR_LBL} py-2.5 font-semibold`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run"]} />
      <HrPayrollShell title="Payroll Run" subtitle="Compute, review, and lock monthly payroll" icon={Calculator}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error ? (
          <HrError text="Failed to load payroll runs." />
        ) : (
        <div className="space-y-5">
          {/* ── How a run works: Create → Process → Lock ── */}
          <div className="bg-card" style={{ border: HR_RULE }}>
            <p className={`${HR_LBL} px-4 pt-3`}>Monthly payroll in three steps</p>
            <div className="grid grid-cols-1 sm:grid-cols-3">
              {([
                ["1", "Create", "Pick the company and month"],
                ["2", "Process", "Compute every employee's salary"],
                ["3", "Lock", "Freeze the payslips for the month"],
              ] as const).map(([n, t, d], i) => (
                <div key={n} className="flex items-center gap-3 px-4 py-3" style={{ borderLeft: i ? "1px solid hsl(var(--foreground) / 0.15)" : undefined }}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center border border-foreground text-[0.6875rem] font-bold text-foreground ${HR_NUM}`}>{n}</span>
                  <div className="min-w-0">
                    <p className={`${HR_HEAD} leading-tight`}>{t}</p>
                    <p className="text-[0.6875rem] text-muted-foreground truncate mt-0.5">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── At a glance ── */}
          <HrStatStrip
            items={[
              { label: "Total runs", value: counts.total },
              { label: "Draft", value: counts.draft, tone: TONE.graphite },
              { label: "Processed", value: counts.processed },
              { label: "Locked", value: counts.locked, tone: TONE.blue },
            ]}
          />

          {/* ── Create ── */}
          {rights.canCreate && (
            <div className={hrCard}>
              <div className="px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
                <h2 className={HR_HEAD}>New payroll run</h2>
                <p className="text-[0.6875rem] text-muted-foreground mt-0.5">Choose who and when — you can process it right after.</p>
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
                  <div className="flex h-9 items-stretch border border-foreground/40 bg-card">
                    <button type="button" onClick={() => setPeriodYear((y) => y - 1)} className="w-9 text-muted-foreground hover:bg-primary/10 hover:text-foreground" aria-label="Previous year">−</button>
                    <input type="number" value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className={`w-16 bg-transparent text-center text-sm font-semibold focus:outline-none border-x border-foreground/20 ${HR_NUM}`} />
                    <button type="button" onClick={() => setPeriodYear((y) => y + 1)} className="w-9 text-muted-foreground hover:bg-primary/10 hover:text-foreground" aria-label="Next year">+</button>
                  </div>
                </div>
                <button onClick={handleCreate} disabled={busy} className={`${KEY_INK} h-9 px-4 whitespace-nowrap`}>
                  <Calculator size={13} /> {busy ? "Working…" : `Create ${MONTHS[periodMonth - 1].slice(0, 3)} ${periodYear} run`}
                </button>
              </div>
            </div>
          )}

          {/* ── Runs ── */}
          <div className={hrCard}>
            <div className="flex items-baseline gap-2.5 px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
              <h3 className={HR_HEAD}>Payroll runs</h3>
              <span className={`${HR_NUM} text-[0.6875rem] text-muted-foreground`}>{runs.length}</span>
              <span className="text-[0.6875rem] text-muted-foreground">· open one to see its employees</span>
            </div>
            {runs.length === 0 ? (
              <HrEmpty
                icon={Calculator}
                title="No payroll runs yet"
                text={rights.canCreate ? "Create your first run above — pick the company and the month." : "Runs created by payroll staff will appear here."}
              />
            ) : (
              <div className="divide-y divide-foreground/15">
                {runs.map((r) => {
                  const step = stepOf(r.Status);
                  const selected = selectedRunId === r.PayrollRunId;
                  return (
                    <div
                      key={r.PayrollRunId}
                      onClick={() => setSelectedRunId(r.PayrollRunId)}
                      className={`group flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 cursor-pointer transition-colors ${selected ? "bg-primary/5" : "hover:bg-primary/5"}`}
                      style={selected ? { boxShadow: "inset 3px 0 0 hsl(var(--foreground))" } : undefined}
                    >
                      {/* Month box */}
                      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center border border-foreground text-foreground">
                        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] leading-none">{MONTHS[r.PeriodMonth - 1].slice(0, 3)}</span>
                        <span className={`${HR_NUM} text-sm font-bold leading-tight`}>{String(r.PeriodYear).slice(2)}</span>
                      </div>
                      <div className="min-w-[10rem] flex-1">
                        <p className="font-heading font-semibold text-foreground">{MONTHS[r.PeriodMonth - 1]} {r.PeriodYear}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.CompanyName || "All Companies"} · <span className={HR_NUM}>{r.EmployeeCount}</span> employee{r.EmployeeCount === 1 ? "" : "s"}</p>
                      </div>
                      {/* Progress through Create → Process → Lock */}
                      <div className="hidden md:flex items-center gap-1" title={`Step ${step} of 3`}>
                        {[1, 2, 3].map((k) => (
                          <span key={k} className="h-2 w-7 border border-foreground" style={{ background: k <= step ? (step === 3 ? "hsl(var(--primary))" : "hsl(var(--foreground))") : "transparent" }} />
                        ))}
                      </div>
                      <div className="w-28"><SheetMark text={r.Status} tone={runTone(r.Status)} /></div>
                      <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button data-row-view="hide" onClick={() => setSelectedRunId(r.PayrollRunId)} title="View records" className={ACT}>
                          <Eye size={14} />
                        </button>
                        {rights.canEdit && r.Status !== "Locked" && (
                          <button onClick={() => handleProcess(r.PayrollRunId)} disabled={busy} title="Process" className={`${KEY_LINE} h-8 px-3`}>
                            <Calculator size={12} /> Process
                          </button>
                        )}
                        {rights.canEdit && r.Status === "Processed" && (
                          <button onClick={() => handleLock(r.PayrollRunId)} disabled={busy} title="Lock" className={`${KEY_INK} h-8 px-3`}>
                            <Lock1 size={12} /> Lock
                          </button>
                        )}
                        {rights.canDelete && (
                          deleteConfirmId === r.PayrollRunId ? (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => handleDelete(r.PayrollRunId)} disabled={busy} className={`${KEY_RED_SOLID} h-8 px-3`}>Confirm</button>
                              <button onClick={() => setDeleteConfirmId(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(r.PayrollRunId)} title="Delete" className={`${ACT} hover:text-destructive hover:border-destructive`}>
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
            <div className={hrCard}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
                <div className="min-w-0">
                  <h3 className={HR_HEAD}>
                    {MONTHS[detail.PeriodMonth - 1]} {detail.PeriodYear} <span className="text-muted-foreground font-semibold">— {detail.CompanyName || "All Companies"}</span>
                  </h3>
                  <p className="text-[0.6875rem] text-muted-foreground mt-0.5"><span className={HR_NUM}>{detail.Employees.length}</span> employee(s) computed</p>
                </div>
                <SheetMark text={detail.Status} tone={runTone(detail.Status)} />
              </div>
              {totals && detail.Employees.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4" style={{ borderBottom: HR_RULE }}>
                  {([
                    ["Gross", totals.gross, TONE.ink],
                    ["Deductions", totals.ded, TONE.red],
                    ["Net pay", totals.net, TONE.ink],
                    ["Total CTC", totals.ctc, TONE.blue],
                  ] as const).map(([l, v, c], i) => (
                    <div key={l} className="px-5 py-3" style={{ borderLeft: i ? "1px solid hsl(var(--foreground) / 0.15)" : undefined }}>
                      <p className={HR_LBL}>{l}</p>
                      <p className={`${HR_NUM} mt-1 text-lg font-bold`} style={{ color: c }}>{inr(v)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: HR_RULE }}>
                      <th className={`${TH} text-left px-5`}>Employee</th>
                      <th className={`${TH} text-left px-4`}>Structure</th>
                      <th className={`${TH} text-right px-4`}>Gross</th>
                      <th className={`${TH} text-right px-4`}>Deduction</th>
                      <th className={`${TH} text-right px-4`}>Net</th>
                      <th className={`${TH} text-right px-4`}>CTC</th>
                      <th className={`${TH} text-right px-5`}>Payslip</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/15">
                    {detail.Employees.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">Not processed yet — use <b>Process</b> on this run above.</td></tr>
                    ) : (
                      detail.Employees.map((e) => (
                        <tr key={e.PayrollRunEmployeeId} className="hover:bg-primary/5 transition-colors">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <HrAvatar name={e.EmployeeName} size={28} />
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate">{e.EmployeeName}</p>
                                <p className={`text-muted-foreground text-[0.6875rem] ${HR_NUM}`}>{e.EmployeeCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.SalaryStructureName || "—"}</td>
                          <td className={`px-4 py-2.5 text-right ${HR_NUM}`}>₹{e.GrossSalary.toLocaleString("en-IN")}</td>
                          <td className={`px-4 py-2.5 text-right text-destructive ${HR_NUM}`}>₹{e.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${HR_NUM}`}>₹{e.NetSalary.toLocaleString("en-IN")}</td>
                          <td className={`px-4 py-2.5 text-right ${HR_NUM}`}>₹{e.TotalCTC.toLocaleString("en-IN")}</td>
                          <td className="px-5 py-2.5 text-right">
                            <button data-row-view
                              onClick={() => navigate(`/hr-payroll/payroll-run/${detail.PayrollRunId}/payslip/${e.EmployeeId}`)}
                              className={`${KEY_LINE} h-8 px-3`}
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
        )}
      </HrPayrollShell>
    </>
  );
};

export default PayrollRun;
