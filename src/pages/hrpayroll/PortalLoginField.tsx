// The "Portal Login" tab of the Employee Master form: this employee's Employee Portal user ID (their saved e-mail),
// whether the login is active, and Create / Reset password / Disable. Same actions as the HR > Employee Portal page.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { HR_LBL, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED } from "@/components/sheet/sheetParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { disablePortalAccess, getPortalEmployees } from "@/api/employeePortalApi";
import { ACCESS, PasswordDialog } from "./EmployeePortalAccess";

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "Never";

export const PortalLoginField: React.FC<{ employeeId: number | null }> = ({ employeeId }) => {
  const rights = usePageRights("employee-portal-access");
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<"enable" | "reset" | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal-employees"],
    queryFn: getPortalEmployees,
    enabled: employeeId != null && rights.canView,
    staleTime: 15_000,
  });
  const disable = useMutation({
    mutationFn: (id: number) => disablePortalAccess(id),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["portal-employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const box = "bg-card p-4";
  if (employeeId == null) {
    return <p className={`${box} text-sm text-muted-foreground`} style={{ border: HR_RULE }}>Save the employee first, then come back here to create their Employee Portal login.</p>;
  }
  if (!rights.canView) {
    return <p className={`${box} text-sm text-muted-foreground`} style={{ border: HR_RULE }}>You don't have access to manage Employee Portal logins.</p>;
  }
  const emp = data?.find((e) => e.EmployeeId === employeeId);
  if (isLoading) return <p className={`${box} text-sm text-muted-foreground`} style={{ border: HR_RULE }}>Loading…</p>;
  if (isError || !emp) return <p className={`${box} text-sm text-destructive`} style={{ border: HR_RULE }}>Could not load this employee's portal login.</p>;

  const a = ACCESS[emp.Access];
  return (
    <div className={`${box} space-y-4`} style={{ border: HR_RULE }}>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <p className={HR_LBL}>User ID (login e-mail)</p>
          <p className="text-sm font-medium mt-1 break-all">{emp.Email || <span className="text-muted-foreground">No e-mail — add it on the Basic Information tab and save</span>}</p>
        </div>
        <div>
          <p className={HR_LBL}>Portal access</p>
          <div className="mt-1"><SheetMark text={a.text} tone={a.tone} /></div>
          {emp.Access === "other" && <p className="text-xs text-muted-foreground mt-1">This e-mail already belongs to a {emp.UserRole} login.</p>}
        </div>
        <div>
          <p className={HR_LBL}>Last sign-in</p>
          <p className="text-sm mt-1">{fmt(emp.LastLoginAt)}</p>
        </div>
      </div>

      {rights.canEdit && (
        <div className="flex flex-wrap gap-2">
          {(emp.Access === "none" || emp.Access === "disabled") && emp.Email && (
            <button type="button" className={`${KEY_INK} h-9 px-4`} onClick={() => setDialog("enable")}>{emp.Access === "none" ? "Create login" : "Re-enable login"}</button>
          )}
          {emp.Access === "active" && (
            <>
              <button type="button" className={`${KEY_LINE} h-9 px-4`} onClick={() => setDialog("reset")}><KeyRound size={13} /> Reset password</button>
              <button type="button" className={`${KEY_RED} h-9 px-4`} disabled={disable.isPending}
                onClick={() => { if (window.confirm(`Disable Employee Portal access for ${emp.EmployeeName}?`)) disable.mutate(emp.EmployeeId); }}>Disable login</button>
            </>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">The employee signs in at the Employee Portal with this e-mail and the password you set. Passwords are never shown after you save them.</p>

      {dialog && <PasswordDialog employee={emp} mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
};
