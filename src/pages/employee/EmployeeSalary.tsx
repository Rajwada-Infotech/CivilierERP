// Salary details: the CTC and structure HR has set, the latest month's breakdown, and the last twelve months' pay.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPortalSalary } from "@/api/employeePortalApi";
import { Card, Loading, MONTHS, Note, PageHeader, Stat, inr, labelCls } from "./employeeUi";

export default function EmployeeSalary() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-salary"], queryFn: getPortalSalary, staleTime: 60_000 });
  const latest = data?.Latest;

  return (
    <>
      <PageHeader title="Salary Details" subtitle="Your monthly salary, from locked payroll months" />
      {isError && <Note tone="error">{(error as Error).message}</Note>}
      {isLoading && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Stat label="CTC" value={data.CTCAmount != null ? inr(data.CTCAmount) : "—"} note={data.CTCFrequency ? `per ${data.CTCFrequency === "Annual" ? "year" : "month"}` : undefined} />
            <Stat label="Salary structure" value={<span className="text-base">{data.SalaryStructureName || "—"}</span>} />
            <Stat label="Latest gross" value={latest ? inr(latest.GrossSalary) : "—"} />
            <Stat label="Latest net" value={latest ? inr(latest.NetSalary) : "—"} note={latest ? `${MONTHS[latest.PeriodMonth - 1]} ${latest.PeriodYear}` : "No payroll locked yet"} />
          </div>

          {latest && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {([["Earnings", latest.Earnings, latest.GrossSalary, "Gross salary"], ["Deductions", latest.Deductions, latest.TotalEmployeeDeduction, "Total deductions"]] as const).map(([title, lines, total, totalLabel]) => (
                <Card key={title} title={`${title} · ${MONTHS[latest.PeriodMonth - 1]} ${latest.PeriodYear}`}>
                  <table className="w-full text-sm"><tbody className="divide-y divide-foreground/15">
                    {lines.length === 0 && <tr><td className="px-4 py-2 text-muted-foreground" colSpan={2}>None</td></tr>}
                    {lines.map((l) => (<tr key={l.HeadCode}><td className="px-4 py-2">{l.HeadName}</td><td className="px-4 py-2 text-right tabular-nums">{inr(l.Amount)}</td></tr>))}
                    <tr className="font-semibold border-t border-foreground/30"><td className="px-4 py-2">{totalLabel}</td><td className="px-4 py-2 text-right tabular-nums">{inr(total)}</td></tr>
                  </tbody></table>
                </Card>
              ))}
            </div>
          )}

          <Card title="Monthly history" right={<Link to="/employee/payslips" className={`${labelCls} hover:text-foreground`}>Payslips</Link>}>
            {data.History.length === 0 ? <Note>Your salary will appear here once HR locks a payroll month.</Note> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className={`${labelCls} text-left border-b border-foreground/30`}><th className="px-4 py-2">Month</th><th className="px-4 py-2 text-right">Gross</th><th className="px-4 py-2 text-right">Deductions</th><th className="px-4 py-2 text-right">Net</th></tr></thead>
                <tbody className="divide-y divide-foreground/15">
                  {data.History.map((h) => (
                    <tr key={h.PayrollRunId}><td className="px-4 py-2">{MONTHS[h.PeriodMonth - 1]} {h.PeriodYear}</td><td className="px-4 py-2 text-right tabular-nums">{inr(h.GrossSalary)}</td><td className="px-4 py-2 text-right tabular-nums">{inr(h.TotalEmployeeDeduction)}</td><td className="px-4 py-2 text-right tabular-nums font-semibold">{inr(h.NetSalary)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
