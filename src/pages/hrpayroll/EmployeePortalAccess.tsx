// HR: who can sign in to the Employee Portal, and how many leave days each person gets.
// Salary, payslips (Payroll Run), attendance, leave approvals and holidays stay on their own HR pages -- the portal
// shows the same data. Employees are matched to their login by the e-mail on the Employee Master record.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, UserRound } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrError, HrSkeleton, HrStatStrip, HR_FIELD, HR_LBL, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED } from "@/components/sheet/sheetParts";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  disablePortalAccess, enablePortalAccess, getBreakRules, saveBreakRules, getEntitlements, getLeavePolicy, getPortalEmployees, resetPortalPassword,
  saveEntitlements, saveLeavePolicy, type PortalAccess, type PortalEmployee,
} from "@/api/employeePortalApi";

const labelCls = `block ${HR_LBL} mb-1.5`;
export const ACCESS: Record<PortalAccess, { text: string; tone: MarkTone }> = {
  active: { text: "Active", tone: "done" },
  disabled: { text: "Disabled", tone: "stopped" },
  none: { text: "No login", tone: "waiting" },
  other: { text: "E-mail in use", tone: "stopped" },
};
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const newPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return `${Array.from(bytes, (b) => chars[b % chars.length]).join("")}#7`;
};

// ── Enable / reset password ──────────────────────────────────────────────────
export function PasswordDialog({ employee, mode, onClose }: { employee: PortalEmployee; mode: "enable" | "reset"; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState(newPassword);
  const save = useMutation({
    mutationFn: () => (mode === "enable" ? enablePortalAccess(employee.EmployeeId, password) : resetPortalPassword(employee.EmployeeId, password)),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["portal-employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader><DialogTitle>{mode === "enable" ? "Enable Employee Portal access" : "Reset password"}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{employee.EmployeeName} signs in with <b>{employee.Email}</b>.</p>
        <div>
          <label className={labelCls} htmlFor="pw">Password (min. 8 characters) — auto-generated below; press Generate for a new one, or type your own</label>
          <div className="flex gap-2">
            <input id="pw" className={HR_FIELD} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            <button type="button" className={`${KEY_LINE} h-9 px-3 shrink-0`} onClick={() => setPassword(newPassword())}>Generate</button>
          </div>
          {save.isSuccess
            ? <p className="text-xs text-foreground mt-2">Saved. Give the employee this password now — it isn't shown again.</p>
            : <p className="text-xs text-muted-foreground mt-2">Share it with the employee yourself; they can't see it afterwards.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button className={`${KEY_LINE} h-9 px-4`} onClick={onClose}>{save.isSuccess ? "Done" : "Cancel"}</button>
          {!save.isSuccess && <button className={`${KEY_INK} h-9 px-4`} disabled={password.length < 8 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : mode === "enable" ? "Enable access" : "Reset password"}</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Leave days for one employee ──────────────────────────────────────────────
function EntitlementDialog({ employee, onClose }: { employee: PortalEmployee; onClose: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useQuery({ queryKey: ["portal-entitlements", employee.EmployeeId, year], queryFn: () => getEntitlements(employee.EmployeeId, year) });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => saveEntitlements(employee.EmployeeId, year, (data?.Items ?? []).map((i) => {
      const raw = edits[i.LeaveType] ?? (i.OverrideDays == null ? "" : String(i.OverrideDays));
      return { LeaveType: i.LeaveType, Days: raw === "" ? null : Number(raw) };
    })),
    onSuccess: (r) => { toast.success(r.message); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader><DialogTitle>Leave days — {employee.EmployeeName}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <label className={HR_LBL} htmlFor="ent-year">Year</label>
          <input id="ent-year" type="number" className={`${HR_FIELD} !w-24`} value={year} onChange={(e) => { setYear(Number(e.target.value) || year); setEdits({}); }} />
        </div>
        {isLoading ? <HrSkeleton /> : (
          <table className="w-full text-sm" style={{ border: HR_RULE }}>
            <thead><tr className={`${HR_LBL} text-left`} style={{ borderBottom: HR_RULE }}><th className="px-3 py-2">Type</th><th className="px-3 py-2">Company policy</th><th className="px-3 py-2">This employee</th></tr></thead>
            <tbody>
              {(data?.Items ?? []).map((i) => (
                <tr key={i.LeaveType} className="border-t border-foreground/15">
                  <td className="px-3 py-2">{i.LeaveType}</td>
                  <td className="px-3 py-2 tabular-nums">{Number(i.PolicyDays)} days</td>
                  <td className="px-3 py-2"><input type="number" min={0} max={366} step={0.5} placeholder="Policy" className={`${HR_FIELD} !w-24`}
                    value={edits[i.LeaveType] ?? (i.OverrideDays == null ? "" : String(i.OverrideDays))} onChange={(e) => setEdits((s) => ({ ...s, [i.LeaveType]: e.target.value }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">Leave a box empty to use the company policy. Unpaid leave has no limit.</p>
        <div className="flex justify-end gap-2">
          <button className={`${KEY_LINE} h-9 px-4`} onClick={onClose}>Cancel</button>
          <button className={`${KEY_INK} h-9 px-4`} disabled={save.isPending || isLoading} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Company-wide leave policy ────────────────────────────────────────────────
function PolicyPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["portal-leave-policy"], queryFn: getLeavePolicy });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => saveLeavePolicy((data ?? []).map((p) => ({ LeaveType: p.LeaveType, DaysPerYear: Number(edits[p.LeaveType] ?? p.DaysPerYear) }))),
    onSuccess: (r) => { toast.success(r.message); setEdits({}); qc.invalidateQueries({ queryKey: ["portal-leave-policy"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading) return <HrSkeleton />;
  return (
    <div className="bg-card p-4 max-w-md" style={{ border: HR_RULE }}>
      <h3 className={`${HR_LBL} mb-3`}>Yearly leave days for every employee</h3>
      <div className="space-y-3">
        {(data ?? []).map((p) => (
          <div key={p.LeaveType} className="flex items-center justify-between gap-3">
            <label className="text-sm" htmlFor={`pol-${p.LeaveType}`}>{p.LeaveType}</label>
            <input id={`pol-${p.LeaveType}`} type="number" min={0} max={366} step={0.5} disabled={!canEdit} className={`${HR_FIELD} !w-24`}
              value={edits[p.LeaveType] ?? String(Number(p.DaysPerYear))} onChange={(e) => setEdits((s) => ({ ...s, [p.LeaveType]: e.target.value }))} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">Counted per calendar year. Balance = days given − approved leave − pending applications. Override for one person from the Employees tab.</p>
      {canEdit && <button className={`${KEY_INK} h-9 px-4 mt-4`} disabled={save.isPending || !Object.keys(edits).length} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save policy"}</button>}
    </div>
  );
}

// ── Break rules: allowed minutes per reason, and whether the time comes off working time ──
function BreakRulesPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["portal-break-rules"], queryFn: getBreakRules });
  const [edits, setEdits] = useState<Record<string, { minutes?: string; deduct?: boolean }>>({});
  const save = useMutation({
    mutationFn: () => saveBreakRules((data ?? []).map((r) => {
      const e = edits[r.BreakType] ?? {};
      const raw = e.minutes ?? (r.AllowedMinutes == null ? "" : String(r.AllowedMinutes));
      return { BreakType: r.BreakType, AllowedMinutes: raw === "" ? null : Number(raw), DeductFromWork: e.deduct ?? r.DeductFromWork, IsActive: r.IsActive };
    })),
    onSuccess: (r) => { toast.success(r.message); setEdits({}); qc.invalidateQueries({ queryKey: ["portal-break-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading) return <HrSkeleton />;
  return (
    <div className="bg-card p-4 max-w-2xl" style={{ border: HR_RULE }}>
      <h3 className={`${HR_LBL} mb-3`}>Break reasons an employee can pick on the portal</h3>
      <table className="w-full text-sm">
        <thead><tr className={`${HR_LBL} text-left`} style={{ borderBottom: HR_RULE }}><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Allowed minutes</th><th className="px-3 py-2">Taken off working time</th></tr></thead>
        <tbody className="divide-y divide-foreground/15">
          {(data ?? []).map((r) => {
            const e = edits[r.BreakType] ?? {};
            return (
              <tr key={r.BreakType}>
                <td className="px-3 py-2">{r.BreakType}{r.RequiresNote && <span className="text-xs text-muted-foreground"> · note required</span>}</td>
                <td className="px-3 py-2"><input type="number" min={0} max={1440} placeholder="No limit" disabled={!canEdit} className={`${HR_FIELD} !w-28`}
                  value={e.minutes ?? (r.AllowedMinutes == null ? "" : String(r.AllowedMinutes))} onChange={(ev) => setEdits((s) => ({ ...s, [r.BreakType]: { ...s[r.BreakType], minutes: ev.target.value } }))} /></td>
                <td className="px-3 py-2"><input type="checkbox" disabled={!canEdit} checked={e.deduct ?? r.DeductFromWork} onChange={(ev) => setEdits((s) => ({ ...s, [r.BreakType]: { ...s[r.BreakType], deduct: ev.target.checked } }))} aria-label={`${r.BreakType} is taken off working time`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground mt-3">Time beyond the allowed minutes is "extra time": the employee gets a reminder when it starts and it shows on Team Attendance and Attendance Records. A reason that is not taken off working time (a meeting at another office) counts as work. A change applies to breaks started after you save; past days keep the rule they had.</p>
      {canEdit && <button className={`${KEY_INK} h-9 px-4 mt-4`} disabled={save.isPending || !Object.keys(edits).length} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save break rules"}</button>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function EmployeePortalAccess() {
  const rights = usePageRights("employee-portal-access");
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["portal-employees"], queryFn: getPortalEmployees });
  const [tab, setTab] = useState<"employees" | "policy" | "breaks">("employees");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ kind: "enable" | "reset" | "leave"; employee: PortalEmployee } | null>(null);
  const disable = useMutation({
    mutationFn: (id: number) => disablePortalAccess(id),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["portal-employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((e) => !q || [e.EmployeeCode, e.EmployeeName, e.Email, e.Department].some((v) => v?.toLowerCase().includes(q)));
  }, [data, search]);
  const count = (a: PortalAccess) => (data ?? []).filter((e) => e.Access === a).length;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "HR", "Employee Portal"]} />
      <HrPayrollShell title="Employee Portal" subtitle="Who can sign in, and their yearly leave days" icon={UserRound}>
        <HrStatStrip items={[
          { label: "Employees", value: (data ?? []).length },
          { label: "Portal active", value: count("active") },
          { label: "No login yet", value: count("none") },
          { label: "Disabled", value: count("disabled") },
        ]} />

        <div className="flex gap-2 my-4">
          {([["employees", "Employees"], ["policy", "Leave policy"], ["breaks", "Break rules"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`${tab === k ? KEY_INK : KEY_LINE} h-9 px-4`}>{l}</button>
          ))}
        </div>

        {tab === "breaks" ? <BreakRulesPanel canEdit={rights.canEdit} /> : tab === "policy" ? <PolicyPanel canEdit={rights.canEdit} /> : isLoading ? <HrSkeleton rows={4} /> : isError ? <HrError text="Failed to load employees." /> : (
          <div className="bg-card" style={{ border: HR_RULE }}>
            <div className="p-3" style={{ borderBottom: HR_RULE }}>
              <input className={`${HR_FIELD} max-w-xs`} placeholder="Search name, code, e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" />
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className={`${HR_LBL} text-left`} style={{ borderBottom: HR_RULE }}>
                <th className="px-3 py-2">Code</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">E-mail</th><th className="px-3 py-2">Portal</th><th className="px-3 py-2">Last sign-in</th><th className="px-3 py-2 text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-foreground/15">
                {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-muted-foreground">No employees match.</td></tr>}
                {rows.map((e) => (
                  <tr key={e.EmployeeId}>
                    <td className="px-3 py-2 whitespace-nowrap">{e.EmployeeCode}</td>
                    <td className="px-3 py-2"><div className="font-medium">{e.EmployeeName}</div><div className="text-xs text-muted-foreground">{[e.Designation, e.Department].filter(Boolean).join(" · ")}</div></td>
                    <td className="px-3 py-2">{e.Email || <span className="text-muted-foreground">Add an e-mail on the Employee Master</span>}</td>
                    <td className="px-3 py-2"><SheetMark text={ACCESS[e.Access].text} tone={ACCESS[e.Access].tone} />{e.Access === "other" && <div className="text-[0.625rem] text-muted-foreground mt-1">Already a {e.UserRole} login</div>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(e.LastLoginAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {rights.canEdit && (e.Access === "none" || e.Access === "disabled") && e.Email && <button className={`${KEY_INK} h-8 px-3`} onClick={() => setDialog({ kind: "enable", employee: e })}>{e.Access === "none" ? "Enable" : "Re-enable"}</button>}
                        {rights.canEdit && e.Access === "active" && <>
                          <button className={`${KEY_LINE} h-8 px-3`} onClick={() => setDialog({ kind: "reset", employee: e })}><KeyRound size={12} /> Password</button>
                          <button className={`${KEY_RED} h-8 px-3`} disabled={disable.isPending} onClick={() => { if (window.confirm(`Disable Employee Portal access for ${e.EmployeeName}?`)) disable.mutate(e.EmployeeId); }}>Disable</button>
                        </>}
                        {rights.canEdit && <button className={`${KEY_LINE} h-8 px-3`} onClick={() => setDialog({ kind: "leave", employee: e })}>Leave days</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </HrPayrollShell>

      {dialog?.kind === "leave" && <EntitlementDialog employee={dialog.employee} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "enable" || dialog?.kind === "reset") && <PasswordDialog employee={dialog.employee} mode={dialog.kind} onClose={() => setDialog(null)} />}
    </>
  );
}
