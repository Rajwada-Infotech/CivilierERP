// The new tab opened by "View employee portal" in Employee Master. It receives a short-lived VIEW-ONLY session for one
// employee from the tab that opened it (by message, never in the URL), stores it in this tab only, and goes to the portal.
import { useEffect, useState } from "react";

export default function EmployeeView() {
  const [msg, setMsg] = useState("Opening the employee portal…");

  useEffect(() => {
    if (!window.opener) {
      setMsg("Open this from HR and Payroll → Employees, using the eye button on an employee.");
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.opener || e.origin !== window.location.origin || e.data?.type !== "ep-view-session") return;
      const { token, user, viewer, employeeName } = e.data as { token: string; user: unknown; viewer: string; employeeName: string };
      // sessionStorage is per tab: only this tab becomes the employee view, the viewer's own tab keeps their ERP session.
      sessionStorage.clear();
      sessionStorage.setItem("token", token);
      sessionStorage.setItem("user", JSON.stringify(user));
      sessionStorage.setItem("ep_view_as", JSON.stringify({ employeeName, viewer }));
      window.location.replace("/employee");
    };
    window.addEventListener("message", onMessage);
    // Tell the opener we are ready (repeated, so it works whichever side finishes loading first).
    const ping = setInterval(() => window.opener?.postMessage({ type: "ep-view-ready" }, window.location.origin), 300);
    const giveUp = setTimeout(() => { clearInterval(ping); setMsg("Could not open the employee portal. Close this tab and try again."); }, 20_000);
    return () => { window.removeEventListener("message", onMessage); clearInterval(ping); clearTimeout(giveUp); };
  }, []);

  return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground p-6 text-center">{msg}</div>;
}
