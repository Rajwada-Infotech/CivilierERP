import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrBreakup, HrEmpty, HrStepHead, hrCard, HR_FIELD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK } from "@/components/sheet/sheetParts";
import { getEmployees, getEmployeeSalaryBreakup, type SalaryBreakupResult } from "@/api/employeeMasterApi";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

// Sheet fields and labels (docs/DESIGN.md): square h-9 fields, small-capital labels.
const inputBase = HR_FIELD;
const labelBase = `block ${HR_LBL} mb-1.5`;

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
          <div className={`${hrCard} p-5`}>
            <HrStepHead n={1} title="Who and when" hint="Pick an employee and the date to calculate on" />
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_12rem_auto] gap-3 items-end">
              <div className="min-w-0">
                <label className={labelBase}>Employee</label>
                <SearchableNativeSelect value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setResult(null); setErrorMsg(null); }} className={inputBase} disabled={employeesLoading} searchPlaceholder="Search name or code…">
                  <option value="">Select...</option>
                  {employees.map((e) => (
                    <option key={e.EmployeeId} value={String(e.EmployeeId)}>
                      {e.EmployeeName} ({e.EmployeeCode})
                    </option>
                  ))}
                </SearchableNativeSelect>
              </div>
              <div>
                <label className={labelBase}>As Of Date</label>
                <DateInput value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputBase} />
              </div>
              <button onClick={handleCalculate} disabled={!employeeId || loading} className={`${KEY_INK} h-9 px-4`}>
                <Calculator size={13} /> {loading ? "Calculating…" : "Calculate"}
              </button>
            </div>

            {selectedEmployee && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] bg-card" style={{ border: HR_RULE }}>
                <div className="flex items-center gap-3 px-3.5 py-3 min-w-0">
                  <HrAvatar name={selectedEmployee.EmployeeName} size={34} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{selectedEmployee.EmployeeName}</p>
                    <p className={`text-[0.6875rem] text-muted-foreground ${HR_NUM}`}>{selectedEmployee.EmployeeCode}</p>
                  </div>
                </div>
                <div className="px-3.5 py-3 border-t sm:border-t-0 sm:border-l border-foreground/20">
                  <p className={HR_LBL}>CTC</p>
                  <p className={`${HR_NUM} text-sm font-bold mt-1 ${selectedEmployee.CTCAmount == null ? "text-destructive" : "text-foreground"}`}>
                    {selectedEmployee.CTCAmount != null ? `₹${Number(selectedEmployee.CTCAmount).toLocaleString("en-IN")}` : "Not set"}
                    {selectedEmployee.CTCAmount != null && <span className="font-normal text-muted-foreground"> / {selectedEmployee.CTCFrequency}</span>}
                  </p>
                </div>
                <div className="px-3.5 py-3 border-t sm:border-t-0 sm:border-l border-foreground/20">
                  <p className={HR_LBL}>Structure</p>
                  <p className={`${HR_NUM} text-sm font-bold mt-1 ${selectedEmployee.SalaryStructureCode ? "text-foreground" : "text-destructive"}`}>
                    {selectedEmployee.SalaryStructureCode || "Not assigned"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="border border-destructive bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{errorMsg}</p>
            </div>
          )}

          {result && !result.valid && (
            <div className="border border-destructive bg-destructive/5 p-4 space-y-1">
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-destructive">This salary structure has validation issues</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-sm text-destructive">{e.message}</p>
              ))}
            </div>
          )}

          {!result && !errorMsg && (
            <div className={hrCard}>
              <HrEmpty icon={Calculator} title="Pick an employee to see their salary" text="The breakup uses their CTC and assigned Salary Structure — the same engine Payroll Run uses." />
            </div>
          )}

          {result && result.valid && result.totals && (
            <div className={`${hrCard} p-5`}>
              <HrStepHead n={2} title={result.EmployeeName} hint={`Structure: ${result.SalaryStructureName} (v${result.SalaryStructureVersion})`} />
              <HrBreakup lines={result.lines} totals={result.totals} />
            </div>
          )}
        </div>
      </HrPayrollShell>
    </>
  );
};

export default SalaryCalculation;
