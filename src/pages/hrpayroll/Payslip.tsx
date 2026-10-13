import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HrPayrollShell, HR_PAYROLL_ACCENT as ACCENT, HR_GRADIENT } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrError, HrSkeleton, hrPrimaryBtn, hrPrimaryStyle } from "@/components/hrpayroll/HrUi";
import { getPayslip, type PayslipLine } from "@/api/payrollRunApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LineTable: React.FC<{ title: string; lines: PayslipLine[]; total: number; tone: string }> = ({ title, lines, total, tone }) => (
  <div className="rounded-xl border border-border overflow-hidden print:rounded-none">
    <div className="flex items-center justify-between px-4 py-2" style={{ background: `${tone}14` }}>
      <h4 className="font-heading font-semibold text-xs uppercase tracking-widest" style={{ color: tone }}>{title}</h4>
      <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">Amount</span>
    </div>
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border/60">
        {lines.length === 0 && (
          <tr><td className="px-4 py-2 text-muted-foreground text-xs" colSpan={2}>None</td></tr>
        )}
        {lines.map((l) => (
          <tr key={l.HeadCode}>
            <td className="px-4 py-2 text-foreground">{l.HeadName}</td>
            <td className="px-4 py-2 text-right tabular-nums">₹{l.Amount.toLocaleString("en-IN")}</td>
          </tr>
        ))}
        <tr className="font-semibold bg-muted/30">
          <td className="px-4 py-2">Total</td>
          <td className="px-4 py-2 text-right tabular-nums">₹{total.toLocaleString("en-IN")}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

// Print-friendly single-employee payslip -- reads only the frozen
// PayrollRunEmployeeLines snapshot (never live Salary Structure/Head
// data), so it stays correct even after the structure later changes
// (spec 13/15).
const Payslip: React.FC = () => {
  const { runId, employeeId } = useParams<{ runId: string; employeeId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["payslip", runId, employeeId],
    queryFn: () => getPayslip(Number(runId), Number(employeeId)),
    enabled: !!runId && !!employeeId,
  });

  if (isLoading) return <HrSkeleton />;
  if (error || !data) return <HrError text="Failed to load payslip." />;

  const period = `${MONTHS[data.Run.PeriodMonth - 1]} ${data.Run.PeriodYear}`;
  const locked = data.Run.Status === "Locked";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run", "Payslip"]} />
      <HrPayrollShell
        title="Payslip"
        subtitle={period}
        action={
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-foreground hover:bg-muted transition-colors">
              <ArrowLeft size={14} /> Back
            </button>
            <button onClick={() => window.print()} className={`${hrPrimaryBtn} !py-1.5 !text-xs`} style={hrPrimaryStyle}>
              <Printer size={14} /> Print
            </button>
          </div>
        }
      >
        <div className="max-w-3xl mx-auto rounded-2xl bg-card border border-border shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
          {/* Document header */}
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 border-b border-border" style={{ background: `${ACCENT}0d` }}>
            <div>
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Payslip</p>
              <p className="font-heading font-bold text-foreground text-lg leading-tight">{data.Run.CompanyName || "-"}</p>
            </div>
            <div className="text-right">
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Pay period</p>
              <p className="font-heading font-bold text-foreground">{period}</p>
              <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold ${locked ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{data.Run.Status}</span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Employee */}
            <div className="flex flex-wrap items-center gap-4">
              <HrAvatar name={data.Employee.EmployeeName} size={48} />
              <div className="min-w-0 flex-1">
                <h2 className="font-heading font-bold text-foreground text-lg leading-tight">{data.Employee.EmployeeName}</h2>
                <p className="text-xs text-muted-foreground font-mono">{data.Employee.EmployeeCode}</p>
              </div>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Designation</dt><dt className="text-muted-foreground">Department</dt><dt className="text-muted-foreground">Structure</dt>
                <dd className="font-medium text-foreground">{data.Employee.Designation || "-"}</dd>
                <dd className="font-medium text-foreground">{data.Employee.Department || "-"}</dd>
                <dd className="font-medium text-foreground">{data.SalaryStructureName || "-"}</dd>
              </dl>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LineTable title="Earnings" lines={data.Earnings} total={data.GrossSalary} tone="#059669" />
              <LineTable title="Deductions" lines={data.Deductions} total={data.TotalEmployeeDeduction} tone="#dc2626" />
            </div>

            {/* Net pay */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4 text-white shadow-sm print:text-black print:border print:border-black" style={{ background: HR_GRADIENT }}>
              <div>
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-white/80 print:text-black">Net pay for {period}</p>
                <p className="text-xs text-white/80 print:text-black">Gross ₹{data.GrossSalary.toLocaleString("en-IN")} − Deductions ₹{data.TotalEmployeeDeduction.toLocaleString("en-IN")}</p>
              </div>
              <span className="font-heading font-bold text-3xl tabular-nums">₹{data.NetSalary.toLocaleString("en-IN")}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LineTable title="Employer Contribution" lines={data.EmployerContributions} total={data.TotalEmployerContribution} tone="#2563eb" />
              {data.Informational.length > 0 && <LineTable title="Informational" lines={data.Informational} total={0} tone="#64748b" />}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-5 py-3.5">
              <span className="font-heading font-semibold text-foreground text-sm">Cost to Company (CTC)</span>
              <span className="font-heading font-bold text-lg tabular-nums text-foreground">₹{data.TotalCTC.toLocaleString("en-IN")}</span>
            </div>

            <p className="text-center text-[0.625rem] text-muted-foreground">This payslip is generated from the {locked ? "locked" : "processed"} payroll run and does not require a signature.</p>
          </div>
        </div>
      </HrPayrollShell>
    </>
  );
};

export default Payslip;
