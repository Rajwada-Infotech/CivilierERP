import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { getPayslip, type PayslipLine } from "@/api/payrollRunApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LineTable: React.FC<{ title: string; lines: PayslipLine[]; total: number }> = ({ title, lines, total }) => (
  <div>
    <h4 className="font-heading font-semibold text-foreground text-xs uppercase tracking-widest mb-2">{title}</h4>
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {lines.length === 0 && (
          <tr><td className="py-1.5 text-muted-foreground text-xs" colSpan={2}>None</td></tr>
        )}
        {lines.map((l) => (
          <tr key={l.HeadCode}>
            <td className="py-1.5 text-foreground">{l.HeadName}</td>
            <td className="py-1.5 text-right font-mono">₹{l.Amount.toLocaleString("en-IN")}</td>
          </tr>
        ))}
        <tr className="font-semibold border-t border-border">
          <td className="py-1.5">Total</td>
          <td className="py-1.5 text-right font-mono">₹{total.toLocaleString("en-IN")}</td>
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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading payslip...</div>;
  if (error || !data) return <div className="p-6 text-red-500">Failed to load payslip.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run", "Payslip"]} />
      <HrPayrollShell
        title="Payslip"
        subtitle={`${MONTHS[data.Run.PeriodMonth - 1]} ${data.Run.PeriodYear}`}
        action={
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-foreground hover:bg-muted transition-colors">
              <ArrowLeft size={14} /> Back
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white shadow-sm">
              <Printer size={14} /> Print
            </button>
          </div>
        }
      >
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm p-6 space-y-6 max-w-3xl mx-auto print:bg-white print:border-0 print:shadow-none">
          <div className="flex items-start justify-between border-b border-border pb-4">
            <div>
              <h2 className="font-heading font-bold text-foreground text-lg">{data.Employee.EmployeeName}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{data.Employee.EmployeeCode} · {data.Employee.Designation || "-"} · {data.Employee.Department || "-"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{data.Run.CompanyName || "-"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Pay Period</p>
              <p className="font-heading font-semibold text-foreground text-sm">{MONTHS[data.Run.PeriodMonth - 1]} {data.Run.PeriodYear}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Structure: {data.SalaryStructureName || "-"}</p>
              <p className={`text-[11px] mt-1 font-medium ${data.Run.Status === "Locked" ? "text-emerald-600" : "text-amber-600"}`}>{data.Run.Status}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <LineTable title="Earnings" lines={data.Earnings} total={data.GrossSalary} />
            <LineTable title="Deductions" lines={data.Deductions} total={data.TotalEmployeeDeduction} />
          </div>

          <div className="rounded-lg border border-border bg-primary/5 p-4 flex items-center justify-between">
            <span className="font-heading font-semibold text-foreground text-sm">Net Salary</span>
            <span className="font-mono font-bold text-lg text-foreground">₹{data.NetSalary.toLocaleString("en-IN")}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <LineTable title="Employer Contribution" lines={data.EmployerContributions} total={data.TotalEmployerContribution} />
            {data.Informational.length > 0 && <LineTable title="Informational" lines={data.Informational} total={0} />}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4 flex items-center justify-between">
            <span className="font-heading font-semibold text-foreground text-sm">Cost to Company (CTC)</span>
            <span className="font-mono font-bold text-lg text-foreground">₹{data.TotalCTC.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </HrPayrollShell>
    </>
  );
};

export default Payslip;
