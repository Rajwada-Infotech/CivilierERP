// Login history: this account's last 100 sign-in attempts, including failed ones, so unfamiliar activity stands out.
import { useQuery } from "@tanstack/react-query";
import { getPortalLoginHistory } from "@/api/employeePortalApi";
import { Card, Loading, Mark, Note, PageHeader, fmtDateTime } from "./employeeUi";

const device = (ua: string | null) => {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" on ") || ua.slice(0, 40);
};

export default function EmployeeLoginHistory() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-login-history"], queryFn: getPortalLoginHistory, staleTime: 30_000 });
  return (
    <>
      <PageHeader title="Login History" subtitle="Your recent sign-ins. If you see one you don't recognise, tell HR and change your password." />
      <Card>
        {isLoading && <Loading />}
        {isError && <Note tone="error">{(error as Error).message}</Note>}
        {data && data.length === 0 && <Note>No sign-ins recorded yet.</Note>}
        {data && data.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-muted-foreground border-b border-foreground/30">
              <th className="px-4 py-2">When (IST)</th><th className="px-4 py-2">Result</th><th className="px-4 py-2">IP address</th><th className="px-4 py-2">Device</th>
            </tr></thead>
            <tbody className="divide-y divide-foreground/15">
              {data.map((h) => (
                <tr key={h.LoginHistoryId}>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(h.LoginAt)}</td>
                  <td className="px-4 py-2"><Mark text={h.Success ? "Approved" : "Rejected"} label={h.Success ? "Success" : "Failed"} /> <span className="text-muted-foreground">{h.Success ? "Signed in" : h.FailureReason || ""}</span></td>
                  <td className="px-4 py-2 tabular-nums">{h.IpAddress || "—"}</td>
                  <td className="px-4 py-2">{device(h.UserAgent)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
