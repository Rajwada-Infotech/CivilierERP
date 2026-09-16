import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { getEmployees, getEmployeeSalaryBreakup, type SalaryBreakupResult } from "@/api/employeeMasterApi";

const inputBase =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelBase = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";

// Standalone version of the "Employee Salary Details" calculation --
// same endpoint Employee Master's modal uses, but as its own page so it
// doesn't require opening a specific employee's row first. Uses the same
// formula engine (via /salary-breakup) Salary Structure's Preview and
// Payroll Run both call through, so results always match.
const SalaryCalculation: React.FC = () => {
  const { data: employeeData, isLoading: employeesLoading } = useQuery({
    queryKey: ["employee-master"],
    queryFn: getEmployees,
    staleTime: 60 * 1000,
  });
  const employees = Array.isArray(employeeData) ? employeeData : [];

  const [employeeId, setEmployeeId] = useState("");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<SalaryBreakupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedEmployee = employees.find((e) => String(e.EmployeeId) === employeeId);

  const handleCalculate = async () => {
    if (!employeeId) return;
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const res = await getEmployeeSalaryBreakup(Number(employeeId), asOfDate);
      setResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to calculate salary");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Salary Calculation"]} />
      <HrPayrollShell title="Salary Calculation" subtitle="Calculate an employee's salary breakup from their CTC and assigned Salary Structure" icon={Calculator}>
        <div className="space-y-5">
          <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/20">
              <h2 className="font-heading font-semibold text-foreground text-sm">Select Employee</h2>
            </div>
            <div className="p-5 flex flex-wrap items-end gap-3">
              <div style={{ minWidth: 260 }}>
                <label className={labelBase}>Employee</label>
                <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setResult(null); setErrorMsg(null); }} className={inputBase} disabled={employeesLoading}>
                  <option value="">Select...</option>
                  {employees.map((e) => (
                    <option key={e.EmployeeId} value={String(e.EmployeeId)}>
                      {e.EmployeeName} ({e.EmployeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelBase}>As Of Date</label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputBase} style={{ width: 170 }} />
              </div>
              <button onClick={handleCalculate} disabled={!employeeId || loading} className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40">
                {loading ? "Calculating..." : "Calculate"}
              </button>
            </div>
            {selectedEmployee && (
              <div className="px-5 pb-4 -mt-2 text-[11px] text-muted-foreground">
                CTC: {selectedEmployee.CTCAmount != null ? `₹${Number(selectedEmployee.CTCAmount).toLocaleString("en-IN")} (${selectedEmployee.CTCFrequency})` : "Not set"}
                {"  ·  "}
                Salary Structure: {selectedEmployee.SalaryStructureCode || "Not assigned"}
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{errorMsg}</p>
            </div>
          )}

          {result && !result.valid && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-1">
              <p className="text-xs font-heading font-semibold text-destructive">This Salary Structure has validation issues</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-sm text-destructive">{e.message}</p>
              ))}
            </div>
          )}

          {result && result.valid && result.totals && (
            <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border bg-muted/20">
                <h3 className="font-heading font-semibold text-foreground text-sm">{result.EmployeeName}</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Structure: {result.SalaryStructureName} (v{result.SalaryStructureVersion})
                </p>
              </div>
              <div className="p-5">
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                        <th className="text-left px-3 py-2">Salary Head</th>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-left px-3 py-2">Calculation</th>
                        <th className="text-right px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.lines.map((l) => (
                        <tr key={l.DeductionAdditionId}>
                          <td className="px-3 py-2 font-medium">{l.HeadName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.HeadType}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.Calculation}</td>
                          <td className="px-3 py-2 text-right font-mono">₹{l.Amount.toLocaleString("en-IN")}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/20 font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Gross Salary</td>
                        <td className="px-3 py-2 text-right font-mono">₹{result.totals.GrossSalary.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Total Employee Deduction</td>
                        <td className="px-3 py-2 text-right font-mono">₹{result.totals.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Net Salary</td>
                        <td className="px-3 py-2 text-right font-mono">₹{result.totals.NetSalary.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Employer Contribution</td>
                        <td className="px-3 py-2 text-right font-mono">₹{result.totals.TotalEmployerContribution.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="bg-primary/10 font-bold">
                        <td className="px-3 py-2" colSpan={3}>Total CTC</td>
                        <td className="px-3 py-2 text-right font-mono">₹{result.totals.TotalCTC.toLocaleString("en-IN")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </HrPayrollShell>
    </>
  );
};

export default SalaryCalculation;
