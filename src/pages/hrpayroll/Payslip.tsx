import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrError, HrSkeleton, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, TONE } from "@/components/sheet/sheetParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { getPayslip, type PayslipLine } from "@/api/payrollRunApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN")}`;

// One block of the payslip (Earnings, Deductions …): a ruled box, its title in the block's colour over an ink rule,
// one row per head, the total under a second rule.
const LineTable: React.FC<{ title: string; lines: PayslipLine[]; total: number; tone: string; showTotal?: boolean }> = ({ title, lines, total, tone, showTotal = true }) => (
  <div className="bg-card overflow-hidden" style={{ border: HR_RULE }}>
    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: HR_RULE }}>
      <h4 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]" style={{ color: tone }}>{title}</h4>
      <span className={HR_LBL}>Amount</span>
    </div>
    <table className="w-full text-sm">
      <tbody className="divide-y divide-foreground/15">
        {lines.length === 0 && (
          <tr><td className="px-4 py-2 text-muted-foreground text-xs" colSpan={2}>None</td></tr>
        )}
        {lines.map((l) => (
          <tr key={l.HeadCode}>
            <td className="px-4 py-2 text-foreground">{l.HeadName}</td>
            <td className={`px-4 py-2 text-right ${HR_NUM}`}>{inr(l.Amount)}</td>
          </tr>
        ))}
        {showTotal && (
          <tr className="font-semibold" style={{ borderTop: HR_RULE }}>
            <td className="px-4 py-2">Total</td>
            <td className={`px-4 py-2 text-right ${HR_NUM}`} style={{ color: tone }}>{inr(total)}</td>
          </tr>
        )}
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

  const period = data ? `${MONTHS[data.Run.PeriodMonth - 1]} ${data.Run.PeriodYear}` : "";
  const locked = data?.Run.Status === "Locked";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll Run", "Payslip"]} />
      <HrPayrollShell
        title="Payslip"
        subtitle={period || undefined}
        action={
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => navigate(-1)} className={`${KEY_LINE} h-9 px-3`}>
              <ArrowLeft size={13} /> Back
            </button>
            {data && (
              <button onClick={() => window.print()} className={`${KEY_INK} h-9 px-4`}>
                <Printer size={13} /> Print
              </button>
            )}
          </div>
        }
      >
        {isLoading ? (
          <HrSkeleton />
        ) : error || !data ? (
          <HrError text="Failed to load payslip." />
        ) : (
        <div className="max-w-3xl mx-auto bg-card overflow-hidden print:border-0" style={{ border: HR_RULE }}>
          {/* Document header */}
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: HR_RULE }}>
            <div>
              <p className={HR_LBL}>Payslip</p>
              <p className="font-heading font-bold text-foreground text-lg leading-tight mt-1">{data.Run.CompanyName || "—"}</p>
            </div>
            <div className="text-right">
              <p className={HR_LBL}>Pay period</p>
              <p className="font-heading font-bold text-foreground mt-1">{period}</p>
              <span className="mt-1.5 inline-flex"><SheetMark text={data.Run.Status} tone={locked ? "done" : "moving"} /></span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Employee */}
            <div className="flex flex-wrap items-center gap-4 pb-5" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.15)" }}>
              <HrAvatar name={data.Employee.EmployeeName} size={44} />
              <div className="min-w-0 flex-1">
                <h2 className="font-heading font-bold text-foreground text-lg leading-tight">{data.Employee.EmployeeName}</h2>
                <p className={`text-xs text-muted-foreground ${HR_NUM}`}>{data.Employee.EmployeeCode}</p>
              </div>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                <dt className={HR_LBL}>Designation</dt><dt className={HR_LBL}>Department</dt><dt className={HR_LBL}>Structure</dt>
                <dd className="font-medium text-foreground">{data.Employee.Designation || "—"}</dd>
                <dd className="font-medium text-foreground">{data.Employee.Department || "—"}</dd>
                <dd className="font-medium text-foreground">{data.SalaryStructureName || "—"}</dd>
              </dl>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LineTable title="Earnings" lines={data.Earnings} total={data.GrossSalary} tone={TONE.ink} />
              <LineTable title="Deductions" lines={data.Deductions} total={data.TotalEmployeeDeduction} tone={TONE.red} />
            </div>

            {/* Net pay — ink band on screen, a ruled box on paper */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-foreground text-card print:bg-transparent print:text-black print:border print:border-black">
              <div>
                <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-card/80 print:text-black">Net pay for {period}</p>
                <p className={`text-xs text-card/80 print:text-black mt-1 ${HR_NUM}`}>Gross {inr(data.GrossSalary)} − Deductions {inr(data.TotalEmployeeDeduction)}</p>
              </div>
              <span className={`font-bold text-3xl ${HR_NUM}`}>{inr(data.NetSalary)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LineTable title="Employer Contribution" lines={data.EmployerContributions} total={data.TotalEmployerContribution} tone={TONE.blue} />
              {data.Informational.length > 0 && <LineTable title="Informational" lines={data.Informational} total={0} tone={TONE.graphite} showTotal={false} />}
            </div>

            <div className="flex items-center justify-between px-5 py-3.5 bg-primary/5 print:bg-transparent" style={{ border: HR_RULE }}>
              <span className={HR_HEAD}>Cost to Company (CTC)</span>
              <span className={`font-bold text-lg text-foreground ${HR_NUM}`}>{inr(data.TotalCTC)}</span>
            </div>

            <p className="text-center text-[0.625rem] text-muted-foreground">This payslip is generated from the {locked ? "locked" : "processed"} payroll run and does not require a signature.</p>
          </div>
        </div>
        )}
      </HrPayrollShell>
    </>
  );
};

export default Payslip;
