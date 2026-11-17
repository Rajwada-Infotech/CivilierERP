// Payslips: every locked month, newest first. View one in place, and Download opens it as a print page (Save as PDF).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { toast } from "sonner";
import { getPortalPayslip, getPortalPayslips, type Payslip } from "@/api/employeePortalApi";
import { printPayslip } from "./printPayslip";
import { Card, Loading, MONTHS, Note, PageHeader, inr, keyLine, labelCls } from "./employeeUi";

function Breakdown({ slip }: { slip: Payslip }) {
  const block = (title: string, lines: Payslip["Earnings"], total: number, totalLabel: string) => (
    <div className="ep-card">
      <div className={`${labelCls} px-4 py-2 border-b border-border`}>{title}</div>
      <table className="w-full text-sm"><tbody className="divide-y divide-foreground/15">
        {lines.length === 0 && <tr><td className="px-4 py-2 text-muted-foreground">None</td></tr>}
        {lines.map((l) => (<tr key={l.HeadCode}><td className="px-4 py-2">{l.HeadName}</td><td className="px-4 py-2 text-right tabular-nums">{inr(l.Amount)}</td></tr>))}
        <tr className="font-semibold border-t border-foreground/30"><td className="px-4 py-2">{totalLabel}</td><td className="px-4 py-2 text-right tabular-nums">{inr(total)}</td></tr>
      </tbody></table>
    </div>
  );
  return (
    <div className="p-4 space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        {block("Earnings", slip.Earnings, slip.GrossSalary, "Gross salary")}
        {block("Deductions", slip.Deductions, slip.TotalEmployeeDeduction, "Total deductions")}
      </div>
      <div className="flex justify-between ep-gold rounded-xl px-4 py-3 font-heading font-bold"><span>Net salary</span><span className="tabular-nums">{inr(slip.NetSalary)}</span></div>
    </div>
  );
}

export default function EmployeePayslips() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-payslips"], queryFn: getPortalPayslips, staleTime: 60_000 });
  const [openId, setOpenId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const open = useQuery({ queryKey: ["ep-payslip", openId], queryFn: () => getPortalPayslip(openId as number), enabled: openId != null, staleTime: 5 * 60_000 });

  const download = async (id: number) => {
    setDownloading(id);
    try {
      printPayslip(await getPortalPayslip(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the payslip");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader title="Payslips" subtitle="View and download your monthly payslips" />
      <Card>
        {isLoading && <Loading />}
        {isError && <Note tone="error">{(error as Error).message}</Note>}
        {data && data.length === 0 && <Note>No payslips yet. A month appears here once HR locks that payroll.</Note>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-foreground/15">
            {data.map((s) => (
              <li key={s.PayrollRunId}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-heading font-bold">{MONTHS[s.PeriodMonth - 1]} {s.PeriodYear}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">Gross {inr(s.GrossSalary)} · Deductions {inr(s.TotalEmployeeDeduction)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-heading font-bold tabular-nums">{inr(s.NetSalary)}</span>
                    <button className={keyLine} onClick={() => setOpenId(openId === s.PayrollRunId ? null : s.PayrollRunId)}><Eye size={13} /> {openId === s.PayrollRunId ? "Hide" : "View"}</button>
                    <button className={keyLine} onClick={() => download(s.PayrollRunId)} disabled={downloading === s.PayrollRunId}><Download size={13} /> {downloading === s.PayrollRunId ? "Opening…" : "Download"}</button>
                  </div>
                </div>
                {openId === s.PayrollRunId && (open.isLoading ? <Loading /> : open.isError ? <Note tone="error">{(open.error as Error).message}</Note> : open.data ? <Breakdown slip={open.data} /> : null)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
