// Opens one payslip as a printable A4 page (choose "Save as PDF" in the print dialog to download it).
import { escapeHtml } from "@/utils/escapeHtml";
import { openPrintWindow } from "@/lib/printList";
import type { Payslip, PayslipLine } from "@/api/employeePortalApi";
import { MONTHS, fmtDate } from "./employeeUi";

const e = (v: unknown) => escapeHtml(v == null || v === "" ? "—" : String(v));
const money = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const rows = (lines: PayslipLine[]) =>
  lines.length ? lines.map((l) => `<tr><td>${e(l.HeadName)}</td><td class="n">${money(l.Amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="mut">None</td></tr>`;

export function printPayslip(p: Payslip) {
  const period = `${MONTHS[p.PeriodMonth - 1]} ${p.PeriodYear}`;
  const emp = p.Employee;
  openPrintWindow(`<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${e(emp.EmployeeCode)} ${period}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 6px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; }
  .grid div span { color: #666; display: inline-block; min-width: 110px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #111; }
  td, th { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: left; }
  th { background: #f1f1f1; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
  .n { text-align: right; white-space: nowrap; } .mut { color: #777; }
  .tot td { font-weight: 700; border-top: 1px solid #111; }
  .net { margin-top: 14px; border: 2px solid #111; padding: 10px 12px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; }
  .foot { margin-top: 18px; color: #777; font-size: 10px; }
</style></head><body>
  <div class="head"><div><h1>${e(emp.CompanyName || "Payslip")}</h1><div>Payslip for ${period}</div></div><div>${e(p.SalaryStructureName)}</div></div>
  <div class="grid">
    <div><span>Employee</span>${e(emp.EmployeeName)}</div><div><span>Employee code</span>${e(emp.EmployeeCode)}</div>
    <div><span>Designation</span>${e(emp.Designation)}</div><div><span>Department</span>${e(emp.Department)}</div>
    <div><span>Date of joining</span>${fmtDate(emp.JoiningDate)}</div><div><span>Bank</span>${e(emp.BankName)} ${emp.BankAccountNumber ? e(emp.BankAccountNumber) : ""}</div>
  </div>
  <div class="cols">
    <div><table><thead><tr><th>Earnings</th><th class="n">Amount</th></tr></thead><tbody>${rows(p.Earnings)}<tr class="tot"><td>Gross salary</td><td class="n">${money(p.GrossSalary)}</td></tr></tbody></table></div>
    <div><table><thead><tr><th>Deductions</th><th class="n">Amount</th></tr></thead><tbody>${rows(p.Deductions)}<tr class="tot"><td>Total deductions</td><td class="n">${money(p.TotalEmployeeDeduction)}</td></tr></tbody></table></div>
  </div>
  <div class="net"><span>Net salary</span><span>${money(p.NetSalary)}</span></div>
  <p class="foot">This is a system-generated payslip.</p>
</body></html>`);
}
