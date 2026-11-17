import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Skel, SheetMark, share } from "@/components/sheet/Sheet";
import { TICKET_PRIORITY_TONE, TICKET_STATUS_TONE, ticketStatusLabel } from "@/components/maintenance/maintParts";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import { getServiceTickets, type ServiceTicketRow } from "@/api/serviceTicketApi";
import { getElectricityDashboard } from "@/api/electricityMaintenanceApi";
import { getSecurityAttendanceDashboard } from "@/api/securityAttendanceApi";

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtNum = (n: number) => n.toLocaleString("en-IN");
const short = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v));

/** Two-part split drawn in ink: the first part solid blue, the rest hatched, then a line per part. */
const Split: React.FC<{ parts: { label: string; value: number; red?: boolean }[]; unit: (n: number) => string }> = ({ parts, unit }) => {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No data yet.</p>;
  return (
    <>
      <div className="hatch" style={{ display: "flex", height: 26, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img"
        aria-label={parts.map((p) => `${p.label} ${unit(p.value)}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <div key={p.label} className="grow" title={`${p.label}: ${unit(p.value)}`}
            style={{ width: `${share(p.value, total)}%`, borderLeft: i ? "1.5px solid var(--ink)" : 0, background: i === 0 ? "var(--blue)" : p.red ? "var(--red)" : "transparent" }} />
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        {parts.map((p, i) => (
          <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
            <i className={i === 0 || p.red ? "" : "hatch"} style={{ width: 10, height: 10, flexShrink: 0, border: "1px solid var(--ink)", background: i === 0 ? "var(--blue)" : p.red ? "var(--red)" : undefined }} />
            <span className="label" style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}>{p.label}</span>
            <span className="figure" style={{ fontSize: 15 }}>{unit(p.value)}</span>
            <span style={{ fontSize: 11.5, color: "var(--graphite)", width: 38, textAlign: "right" }}>{Math.round(share(p.value, total))}%</span>
          </div>
        ))}
      </div>
    </>
  );
};

/** The last 14 days: the amount billed each day, as bars on a base line. */
const DayPlot: React.FC<{ rows: { date: string; amount: number }[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, pad = 8, top = 24, base = 184;
  const slot = (W - pad * 2) / Math.max(1, rows.length);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const w = Math.min(30, slot * 0.5);
  const active = hover != null ? rows[hover] : null;
  const dayLabel = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Billed amount</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${dayLabel(active.date)} · ${fmt(active.amount)}` : "Hover a day for its figure"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Amount billed each day, last 14 days" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{short(max)}</text>
        {rows.map((r, i) => {
          const cx = pad + slot * i + slot / 2;
          const h = (r.amount / max) * (base - top);
          const on = hover == null || hover === i;
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              {r.amount > 0
                ? <rect x={cx - w / 2} y={base - h} width={w} height={h} fill="var(--blue)" fillOpacity={on ? 0.92 : 0.4} />
                : <text x={cx} y={base - 6} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--faint)">—</text>}
              {(i % 2 === 0 || i === rows.length - 1) && (
                <text x={cx} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="9" letterSpacing="0.5" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{dayLabel(r.date).toUpperCase()}</text>
              )}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
    </div>
  );
};

// Everything shown here is real, read from data the module's own pages already load: the Customer Directory,
// Charge Heads, Bills, Service Requests, Electricity and Security Attendance. A section whose page the viewer
// can't open is left out rather than shown empty.
export default function MaintenanceDashboard() {
  usePageRights("maintenance-dashboard");
  const navigate = useNavigate();
  const ticketRights = usePageRights("crm-service-tickets");
  const elecRights = usePageRights("maintenance-electricity");
  const secRights = usePageRights("maintenance-security-attendance");

  const { data: directory, isLoading: directoryLoading, refetch: r1, isFetching: f1, dataUpdatedAt } = useQuery({
    queryKey: ["maintenance-directory", ""],
    queryFn: () => getMaintenanceDirectory(""),
    staleTime: 60 * 1000,
  });
  const { data: chargeHeads, isLoading: chargeHeadsLoading, refetch: r2, isFetching: f2 } = useQuery({
    queryKey: ["charge-heads", "active"],
    queryFn: getActiveChargeHeads,
    staleTime: 60 * 1000,
  });
  const { data: bills, isLoading: billsLoading, refetch: r3, isFetching: f3 } = useQuery({
    queryKey: ["maintenance-bills", {}],
    queryFn: () => getMaintenanceBills(),
    staleTime: 60 * 1000,
  });
  const { data: tickets, isLoading: ticketsLoading, refetch: r4, isFetching: f4 } = useQuery({
    queryKey: ["maint-service-tickets", { search: "", statusFilter: "" }],
    queryFn: () => getServiceTickets({ handedOverOnly: true }),
    select: (d) => (Array.isArray(d) ? d : Array.isArray((d as { rows?: ServiceTicketRow[] })?.rows) ? (d as { rows: ServiceTicketRow[] }).rows : []),
    enabled: ticketRights.canView,
    staleTime: 60 * 1000,
  });
  const { data: elec, isLoading: elecLoading, refetch: r5, isFetching: f5 } = useQuery({
    queryKey: ["electricity-dashboard"],
    queryFn: getElectricityDashboard,
    enabled: elecRights.canView,
    staleTime: 60 * 1000,
  });
  const { data: sec, isLoading: secLoading, refetch: r6, isFetching: f6 } = useQuery({
    queryKey: ["security-attendance-dashboard"],
    queryFn: getSecurityAttendanceDashboard,
    enabled: secRights.canView,
    staleTime: 60 * 1000,
  });
  const fetching = f1 || f2 || f3 || f4 || f5 || f6;
  const reRead = () => {
    r1(); r2(); r3();
    if (ticketRights.canView) r4();
    if (elecRights.canView) r5();
    if (secRights.canView) r6();
  };

  const directoryRows = Array.isArray(directory) ? directory : [];
  const chargeHeadRows = chargeHeads || [];
  const billRows = Array.isArray(bills) ? bills : [];
  const ticketRows: ServiceTicketRow[] = Array.isArray(tickets) ? tickets : [];
  const activeBills = billRows.filter((b) => b.Status === "Active");
  const cancelledBills = billRows.filter((b) => b.Status === "Cancelled");
  const totalBilled = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);

  const billedIds = new Set(activeBills.map((b) => b.BookingId));
  const billedCustomerCount = billedIds.size;
  const unbilledCustomerCount = Math.max(0, directoryRows.length - billedCustomerCount);

  // Bills raised this calendar month (by Bill Date).
  const monthKey = new Date().toISOString().slice(0, 7);
  const billsThisMonth = activeBills.filter((b) => (b.BillDate || "").slice(0, 7) === monthKey);
  const billedThisMonth = billsThisMonth.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);

  // Service requests still open, and how many have run past their SLA date.
  const today = new Date().toISOString().slice(0, 10);
  const openTickets = ticketRows.filter((t) => !["Resolved", "Closed"].includes(t.Status));
  const overdueTickets = openTickets.filter((t) => t.SlaDueDate && t.SlaDueDate.slice(0, 10) < today);
  const urgentTickets = openTickets.filter((t) => t.Priority === "Urgent");

  const n = (v: unknown) => Number(v) || 0;
  const readingPending = n(elec?.readingPending);
  const absentToday = n(sec?.absentToday);
  const lateToday = n(sec?.lateToday);

  // Last 14 days of billing activity, by Bill Date.
  const trendData = React.useMemo(() => {
    const days: { date: string; amount: number }[] = [];
    const byDate = new Map<string, number>();
    activeBills.forEach((b) => {
      if (!b.BillDate) return;
      const key = b.BillDate.slice(0, 10);
      byDate.set(key, (byDate.get(key) || 0) + (Number(b.GrandTotal) || 0));
    });
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, amount: byDate.get(key) || 0 });
    }
    return days;
  }, [activeBills]);
  const hasTrend = trendData.some((d) => d.amount > 0);
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();

  const latestBills = [...billRows].sort((a, b) => Date.parse(b.BillDate || "") - Date.parse(a.BillDate || "") || b.Id - a.Id).slice(0, 6);
  const latestTickets = [...openTickets].sort((a, b) => Date.parse(a.SlaDueDate || "9999") - Date.parse(b.SlaDueDate || "9999")).slice(0, 6);

  const figures: { label: string; value: string; to: string; red?: boolean; sub?: string }[] = [
    { label: "Handed-over customers", value: directoryLoading ? "…" : fmtNum(directoryRows.length), to: "/maintenance/directory", sub: `${fmtNum(unbilledCustomerCount)} not yet billed` },
    { label: "Bills issued", value: billsLoading ? "…" : fmtNum(activeBills.length), to: "/maintenance/bills", sub: `${fmtNum(billsThisMonth.length)} this month` },
    { label: "Total billed", value: billsLoading ? "…" : fmt(totalBilled), to: "/maintenance/bills", sub: `${fmt(billedThisMonth)} this month` },
    { label: "Active charge heads", value: chargeHeadsLoading ? "…" : fmtNum(chargeHeadRows.length), to: "/masters/charge-head" },
    ...(ticketRights.canView ? [{ label: "Open service requests", value: ticketsLoading ? "…" : fmtNum(openTickets.length), to: "/maintenance/service-requests", red: overdueTickets.length > 0, sub: `${fmtNum(overdueTickets.length)} past SLA` }] : []),
    ...(elecRights.canView ? [{ label: "Meters", value: elecLoading ? "…" : fmtNum(n(elec?.totalMeters)), to: "/maintenance/electricity", red: readingPending > 0, sub: `${fmtNum(readingPending)} reading${readingPending === 1 ? "" : "s"} pending` }] : []),
    ...(secRights.canView ? [{ label: "Security on duty", value: secLoading ? "…" : fmtNum(n(sec?.currentlyOnDuty)), to: "/maintenance/security-attendance", red: absentToday > 0, sub: `${fmtNum(n(sec?.presentToday))} present · ${fmtNum(absentToday)} absent today` }] : []),
  ];

  // B — only the lines that apply right now.
  const attention: { text: string; to: string }[] = [
    ...(unbilledCustomerCount > 0 && !billsLoading && !directoryLoading ? [{ text: `${fmtNum(unbilledCustomerCount)} handed-over customer${unbilledCustomerCount === 1 ? " has" : "s have"} no maintenance bill yet`, to: "/maintenance/bills" }] : []),
    ...(overdueTickets.length ? [{ text: `${fmtNum(overdueTickets.length)} service request${overdueTickets.length === 1 ? " is" : "s are"} past the SLA date`, to: "/maintenance/service-requests" }] : []),
    ...(urgentTickets.length ? [{ text: `${fmtNum(urgentTickets.length)} urgent service request${urgentTickets.length === 1 ? "" : "s"} still open`, to: "/maintenance/service-requests" }] : []),
    ...(readingPending > 0 ? [{ text: `${fmtNum(readingPending)} meter reading${readingPending === 1 ? " is" : "s are"} pending`, to: "/maintenance/electricity" }] : []),
    ...(absentToday > 0 ? [{ text: `${fmtNum(absentToday)} security staff absent today`, to: "/maintenance/security-attendance" }] : []),
    ...(lateToday > 0 ? [{ text: `${fmtNum(lateToday)} security staff late today`, to: "/maintenance/security-attendance" }] : []),
  ];

  const goTo: [string, string][] = [
    ["Customer Directory", "/maintenance/directory"],
    ["Bills", "/maintenance/bills"],
    ["Service Requests", "/maintenance/service-requests"],
    ["Electricity", "/maintenance/electricity"],
    ["Security Attendance", "/maintenance/security-attendance"],
    ["Charge Heads", "/masters/charge-head"],
  ];

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Maintenance"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Maintenance</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Maintenance overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Handed-over customers, the bills raised for them, open service requests, meter readings and today's security attendance.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 260px", maxWidth: 360, minWidth: 240, display: "grid", gridTemplateColumns: "1fr auto", gridTemplateRows: "1fr auto", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "12px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 4 }}>Date</span>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "center" }}>
              <button onClick={reRead} disabled={fetching} className="label link" style={{ color: "var(--blue)" }}>
                {fetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {/* A — figures, each opens its page */}
        <Detail tag="A" title="Right now">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "20px 28px" }}>
            {figures.map((f) => (
              <button key={f.label} onClick={() => navigate(f.to)} style={{ textAlign: "left" }}>
                <span className="label link" style={{ display: "inline-block", marginBottom: 8, color: f.red ? "var(--red)" : undefined }}>{f.label}</span>
                <span className="figure" style={{ display: "block", fontSize: "clamp(24px, 3vw, 36px)", color: f.red ? "var(--red)" : undefined }}>{f.value}</span>
                {f.sub && <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--graphite)" }}>{f.sub}</span>}
              </button>
            ))}
          </div>
        </Detail>

        {/* B — needs attention */}
        <Detail tag="B" title="Needs attention" note={attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"}` : undefined}>
          {attention.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>Nothing needs attention right now.</p>
          ) : (
            <div>
              {attention.map((a) => (
                <button key={a.text} onClick={() => navigate(a.to)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                  <i style={{ width: 8, height: 8, flexShrink: 0, background: "var(--red)" }} />
                  <span style={{ fontSize: 13, color: "var(--ink)", flex: 1 }}>{a.text}</span>
                  <span className="label link">Open</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* C, D — breakdown */}
        <div className="grid2">
          <Detail tag="C" title="Bill status" note={`${fmtNum(billRows.length)} bill${billRows.length === 1 ? "" : "s"}`}>
            {billsLoading ? (<><Skel h={26} /><Skel h={30} /><Skel h={30} /></>) : (
              <Split unit={fmtNum} parts={[{ label: "Active", value: activeBills.length }, { label: "Cancelled", value: cancelledBills.length, red: true }]} />
            )}
          </Detail>
          <Detail tag="D" title="Billed vs not yet billed" note={`${fmtNum(directoryRows.length)} customer${directoryRows.length === 1 ? "" : "s"}`}>
            {billsLoading || directoryLoading ? (<><Skel h={26} /><Skel h={30} /><Skel h={30} /></>) : (
              <Split unit={fmtNum} parts={[{ label: "Billed", value: billedCustomerCount }, { label: "Not yet billed", value: unbilledCustomerCount }]} />
            )}
          </Detail>
        </div>

        {/* E — last 14 days */}
        <Detail tag="E" title="Billing amount — last 14 days" note={fmt(trendData.reduce((s, d) => s + d.amount, 0))}>
          {billsLoading ? <Skel h={200} /> : !hasTrend ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No billing activity in the last 14 days.</p>
          ) : <DayPlot rows={trendData} />}
        </Detail>

        {/* F — latest bills */}
        <Detail tag="F" title="Latest bills" note={`${fmtNum(billRows.length)} in all`}>
          {billsLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : latestBills.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No bills raised yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 620 }}>
                <thead><tr><th>Bill</th><th>Customer</th><th>Flat</th><th>Bill date</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {latestBills.map((b) => (
                    <tr key={b.Id} className="go" onClick={() => navigate("/maintenance/bills")}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{b.BillNo}</span></td>
                      <td>{b.CustomerName || "—"}</td>
                      <td>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="mono">{b.BillDate ? new Date(b.BillDate).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="num figure">{fmt(Number(b.GrandTotal) || 0)}</td>
                      <td><SheetMark text={b.Status} tone={b.Status === "Active" ? "done" : "stopped"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Detail>

        {/* G — open service requests */}
        {ticketRights.canView && (
          <Detail tag="G" title="Open service requests" note={`${fmtNum(openTickets.length)} open`}>
            {ticketsLoading ? (<><Skel h={26} /><Skel h={26} /></>) : latestTickets.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No open service requests.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 620 }}>
                  <thead><tr><th>Ticket</th><th>Subject</th><th>Customer</th><th>Priority</th><th>SLA</th><th>Status</th></tr></thead>
                  <tbody>
                    {latestTickets.map((t) => {
                      const late = !!t.SlaDueDate && t.SlaDueDate.slice(0, 10) < today;
                      return (
                        <tr key={t.Id} className="go" onClick={() => navigate("/maintenance/service-requests")}>
                          <td><span className="mono" style={{ fontWeight: 600 }}>{t.TicketNo}</span></td>
                          <td>{t.Subject}</td>
                          <td>{t.ApplicantName || "—"}</td>
                          <td><SheetMark text={t.Priority} tone={TICKET_PRIORITY_TONE[t.Priority] ?? "draft"} /></td>
                          <td className="mono" style={{ color: late ? "var(--red)" : undefined }}>{t.SlaDueDate ? new Date(t.SlaDueDate).toLocaleDateString("en-IN") : "—"}</td>
                          <td><SheetMark text={ticketStatusLabel(t.Status)} tone={TICKET_STATUS_TONE[t.Status] ?? "waiting"} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Detail>
        )}

        {/* Go to */}
        <Detail tag={ticketRights.canView ? "H" : "G"} title="Go to">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px" }}>
            {goTo.map(([label, to]) => (
              <button key={to} onClick={() => navigate(to)} className="label link" style={{ color: "var(--ink)" }}>{label}</button>
            ))}
          </div>
        </Detail>
      </div>
    </div>
  );
}
