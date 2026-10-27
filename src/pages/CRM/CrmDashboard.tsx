import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SHEET_CSS, Detail, Dimension, Skel, n0, fmtInt, fmtMoney, money, share } from "@/components/sheet/Sheet";

// CRM Dashboard, drawn as an architect's sheet.
//
// The module sells buildings, so the page borrows the drawing office's own language instead of generic dashboard
// cards: one bordered sheet with a title block, lettered details (A-H), dimension lines for anything that is a span
// (collected against demanded), hatching for what is not yet built (money not yet received), and a red pencil used for
// one thing only - items that need someone's attention. Colours and fonts come from the app theme (card, foreground,
// border, primary, destructive; Sora and DM Sans), so the sheet follows whichever theme is selected.

const API = "/api/crm/dashboard";

// ── Number formatting ───────────────────────────────────────────────────────
const sumCount = (rows: any[] = []) => rows.reduce((s, r) => s + n0(r.Count), 0);

// ── C: the pipeline, drawn as a section through four stages ─────────────────
const PipelineSection: React.FC<{ funnel: any; onOpen: (path: string) => void }> = ({ funnel, onOpen }) => {
  const stages = [
    { key: "Applications", label: "Applications", path: "/crm/applications" },
    { key: "Bookings", label: "Bookings", path: "/crm/bookings" },
    { key: "Agreements", label: "Agreements", path: "/crm/agreements" },
    { key: "Possessions", label: "Possessions", path: "/crm/handover" },
  ].map((s) => ({ ...s, value: n0(funnel?.[s.key]) }));
  const max = Math.max(1, ...stages.map((s) => s.value));
  const W = 760, H = 150, mid = 70, bw = 112, gap = (W - bw * 4) / 3;
  const half = (v: number) => Math.max(5, (v / max) * 58);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Sales pipeline from applications to possessions">
        <defs>
          <pattern id="crm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--blue)" strokeWidth="1" opacity="0.35" />
          </pattern>
        </defs>
        <line x1="0" y1={mid} x2={W} y2={mid} stroke="var(--rule)" strokeDasharray="10 4 2 4" />
        {stages.map((s, i) => {
          const x = i * (bw + gap);
          const h = half(s.value);
          const next = stages[i + 1];
          const nh = next ? half(next.value) : 0;
          return (
            <g key={s.key}>
              {next && (
                <polygon points={`${x + bw},${mid - h} ${x + bw + gap},${mid - nh} ${x + bw + gap},${mid + nh} ${x + bw},${mid + h}`} fill="url(#crm-hatch)" stroke="var(--blue)" strokeOpacity="0.35" />
              )}
              <rect x={x} y={mid - h} width={bw} height={h * 2} fill="var(--blue)" fillOpacity={1 - i * 0.17} stroke="var(--ink)" strokeWidth="1.2" />
              {next && (
                <text x={x + bw + gap / 2} y={mid + 4} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="11" fill="var(--ink)">
                  {s.value > 0 ? `${Math.round((next.value / s.value) * 100)}%` : "—"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="stages" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 4 }}>
        {stages.map((s, i) => (
          <button key={s.key} onClick={() => onOpen(s.path)} style={{ textAlign: i === 0 ? "left" : i === 3 ? "right" : "center" }}>
            <div className="figure" style={{ fontSize: 26 }}>{fmtInt(s.value)}</div>
            <div className="label link" style={{ display: "inline-block", marginTop: 5 }}>{s.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── F: twelve months, bars for money received and a line for bookings ───────
const TrendPlot: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 230, padL = 8, padR = 8, top = 16, base = 186;
  const n = Math.max(1, rows.length);
  const slot = (W - padL - padR) / n;
  const maxMoney = Math.max(1, ...rows.map((r) => n0(r.Collected)));
  const maxCount = Math.max(1, ...rows.map((r) => Math.max(n0(r.Bookings), n0(r.Applications))));
  const y = (v: number, max: number) => base - (v / max) * (base - top);
  const cx = (i: number) => padL + slot * i + slot / 2;
  const line = (key: string) => rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(n0(r[key]), maxCount).toFixed(1)}`).join(" ");
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Received</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 2, background: "var(--ink)", display: "inline-block" }} /> Bookings</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 0, borderTop: "2px dashed var(--graphite)", display: "inline-block" }} /> Applications</span>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-2)" }}>
          {active ? `${active.MonthLabel} · ${money(active.Collected)} received · ${fmtInt(active.Bookings)} bookings · ${fmtInt(active.Applications)} applications` : "Hover a month for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Money received, bookings and applications by month" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(maxMoney * t, maxMoney)} y2={y(maxMoney * t, maxMoney)} stroke="var(--rule)" strokeDasharray={t === 0 ? undefined : "2 5"} />
            {t > 0 && <text x={padL + 2} y={y(maxMoney * t, maxMoney) - 4} fontFamily="DM Sans, sans-serif" fontSize="9" fill="var(--graphite)">{money(maxMoney * t)}</text>}
          </g>
        ))}
        {rows.map((r, i) => {
          const h = base - y(n0(r.Collected), maxMoney);
          const w = Math.min(34, slot * 0.52);
          return (
            <g key={r.MonthLabel || i} onMouseEnter={() => setHover(i)}>
              <rect x={padL + slot * i} y={top - 8} width={slot} height={H - top + 8} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              <rect x={cx(i) - w / 2} y={base - h} width={w} height={Math.max(0, h)} fill="var(--blue)" fillOpacity={hover == null || hover === i ? 0.9 : 0.4} />
              <text x={cx(i)} y={base + 16} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{String(r.MonthLabel || "").slice(0, 3).toUpperCase()}</text>
              <text x={cx(i)} y={base + 29} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="8" fill="var(--faint)">{String(r.MonthLabel || "").slice(-2)}</text>
            </g>
          );
        })}
        {rows.length > 1 && (
          <>
            <path d={line("Applications")} fill="none" stroke="var(--graphite)" strokeWidth="1.4" strokeDasharray="4 4" pointerEvents="none" />
            <path className="draw" d={line("Bookings")} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />
            {rows.map((r, i) => (
              <circle key={i} cx={cx(i)} cy={y(n0(r.Bookings), maxCount)} r={hover === i ? 4.5 : 3} fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.6" pointerEvents="none" />
            ))}
          </>
        )}
      </svg>
    </div>
  );
};

// ── H: one register = one bar split by status ───────────────────────────────
const STATUS_TONE: Record<string, { fill: string; hatch?: boolean }> = {
  Approved: { fill: "var(--blue)" }, Confirmed: { fill: "var(--blue)" }, Completed: { fill: "var(--ink)" }, Resolved: { fill: "var(--blue)" },
  Closed: { fill: "var(--ink)" }, Pending: { fill: "var(--rule)", hatch: true }, Draft: { fill: "var(--rule-soft)", hatch: true }, Scheduled: { fill: "var(--blue-mid)" },
  Open: { fill: "var(--red)" }, Cancelled: { fill: "var(--red)" }, Rejected: { fill: "var(--red)" },
};
const tone = (status: string) => STATUS_TONE[status] || { fill: "var(--faint)" };

const Register: React.FC<{ name: string; rows: any[]; onOpen: () => void }> = ({ name, rows, onOpen }) => {
  const total = sumCount(rows);
  const sorted = [...rows].sort((a, b) => n0(b.Count) - n0(a.Count));
  return (
    <button onClick={onOpen} style={{ display: "block", width: "100%", padding: "10px 0", borderBottom: "1px solid var(--rule-soft)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span className="label link" style={{ color: "var(--ink)" }}>{name}</span>
        <span className="figure" style={{ fontSize: 17 }}>{fmtInt(total)}</span>
      </div>
      <div style={{ display: "flex", height: 9, marginTop: 7, border: "1px solid var(--ink)", background: "var(--sheet)" }}>
        {total === 0 ? null : sorted.map((r) => (
          <span key={r.Status} title={`${r.Status}: ${r.Count}`} className={tone(r.Status).hatch ? "hatch" : undefined}
            style={{ width: `${share(r.Count, total)}%`, background: tone(r.Status).hatch ? undefined : tone(r.Status).fill, borderRight: "1px solid var(--sheet)" }} />
        ))}
      </div>
      <div className="mono" style={{ marginTop: 6, fontSize: 10, color: "var(--graphite)", lineHeight: 1.6 }}>
        {total === 0 ? "No records" : sorted.slice(0, 4).map((r) => `${r.Status} ${r.Count}`).join("  ·  ")}
      </div>
    </button>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────
const CrmDashboard: React.FC = () => {
  usePageRights("crm-dashboard");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("crm_dash_project") || "");
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["crm-dashboard", projectId],
    queryFn: async () => {
      const r = await fetchWithAuth(projectId ? `${API}?projectId=${projectId}` : API);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => { setUpdatedAt(new Date()); }, [data]);

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["crm-dashboard"] }); }, [qc]);
  const pickProject = (value: string) => {
    setProjectId(value);
    if (value) localStorage.setItem("crm_dash_project", value);
    else localStorage.removeItem("crm_dash_project");
  };

  const alerts = data?.alerts ?? {};
  const metrics = data?.metrics ?? {};
  const payments = data?.payments ?? {};
  const projects: any[] = data?.projects ?? [];
  const trend: any[] = data?.monthlyTrend ?? [];
  const week: any[] = data?.thisWeek ?? [];
  const perProject: any[] = metrics.collectionPerProject ?? [];

  const due = n0(payments.TotalDue);
  const paid = n0(payments.TotalPaid);
  const outstanding = Math.max(0, due - paid);
  const paidPct = share(paid, due);
  const next30 = n0(metrics.forwardDue30Days);
  const next30Pct = Math.min(100 - paidPct, share(next30, due));

  const attention = useMemo(() => {
    const items = [
      { key: "overduePayments", label: "Overdue payments", note: "Demand milestones past their due date", path: "/crm/payments", hot: true },
      { key: "disputedNotices", label: "Possession notices disputed", note: "Disputed by the customer", path: "/crm/possession-notice", hot: true },
      { key: "urgentTickets", label: "Urgent service tickets", note: "High priority, not resolved", path: "/crm/service-tickets", hot: true },
      { key: "welcomeCallPending", label: "Welcome calls pending", note: "Approved bookings with no call made", path: "/crm/welcome-calls", hot: false },
      { key: "agreementsPending", label: "Agreements need action", note: "None drawn up, or in draft over 5 days", path: "/crm/agreements", hot: false },
      { key: "deedsAwaitingCustomer", label: "Deeds awaiting customer", note: "Not yet approved on the portal", path: "/crm/sales-deed", hot: false },
      { key: "deedsAwaitingDirector", label: "Deeds awaiting director", note: "Pending director approval", path: "/crm/sales-deed", hot: false },
      { key: "nocsNotIssued", label: "NOCs not issued", note: "Approved, not handed over", path: "/crm/noc", hot: false },
      { key: "cancellationsPending", label: "Cancellations pending", note: "Awaiting management approval", path: "/crm/cancellations", hot: false },
      { key: "handoversThisWeek", label: "Handovers this week", note: "Scheduled in the next 7 days", path: "/crm/handover", hot: false },
    ].map((i) => ({ ...i, count: n0(alerts[i.key]) }));
    const open = items.filter((i) => i.count > 0).sort((a, b) => Number(b.hot) - Number(a.hot) || b.count - a.count);
    return { open, clear: items.filter((i) => i.count === 0), max: Math.max(1, ...open.map((i) => i.count)) };
  }, [alerts]);

  const weekMax = Math.max(1, ...week.map((d) => n0(d.Handovers) + n0(d.Registries) + n0(d.MilestonesDue)));
  const collected = fmtMoney(paid);
  const projectName = projects.find((p) => String(p.Id) === projectId)?.Name;

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "CRM"]} />

      <div className="crm-sheet">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Customer relations</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05, textWrap: "balance" as any }}>
              Sales &amp; collection register
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Every booking from application to possession, the money against it, and what is waiting on someone.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 300px", maxWidth: 420, minWidth: 260, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 12 }}>
            <label style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)", display: "block" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Project</span>
              <select value={projectId} onChange={(e) => pickProject(e.target.value)} aria-label="Project">
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
              </select>
            </label>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Date</span>
              {updatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <span>
                <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
                {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <button onClick={refresh} className="label link" style={{ color: "var(--blue)" }} disabled={isFetching}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {/* A: collection */}
        <div className="grid2">
          <Detail tag="A" title="Collection" note={projectName || "All projects"}>
            {isLoading ? (<><Skel h={54} w="55%" /><Skel h={26} /><Skel w="70%" /></>) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <span className="figure" style={{ fontSize: "clamp(44px, 6vw, 76px)" }}>
                    <span style={{ fontSize: "0.5em", fontWeight: 500, marginRight: 4, color: "var(--ink-2)" }}>₹</span>{collected.num}
                    <span style={{ fontSize: "0.34em", fontWeight: 500, marginLeft: 6, letterSpacing: 0 }}>{collected.unit}</span>
                  </span>
                  <span style={{ paddingBottom: 8, fontSize: 14, color: "var(--ink-2)" }}>
                    received of <b style={{ color: "var(--ink)" }}>{money(due)}</b> demanded
                  </span>
                </div>

                <div style={{ marginTop: 22 }}>
                  <div style={{ position: "relative", display: "flex", height: 30, border: "1.5px solid var(--ink)", background: "var(--sheet)" }} role="img"
                    aria-label={`${Math.round(paidPct)} percent of the demand received`}>
                    <div className="grow" style={{ width: `${paidPct}%`, background: "var(--blue)" }} />
                    <div className="hatch" style={{ flex: 1, position: "relative" }}>
                      {next30Pct > 0 && paidPct < 100 && (
                        <div title={`${money(next30)} falls due in the next 30 days`} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(next30Pct / (100 - paidPct)) * 100}%`, borderRight: "1.5px dashed var(--ink)", background: "var(--blue-tint)" }} />
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex" }}>
                    <div style={{ width: `${Math.max(paidPct, 14)}%`, minWidth: 0 }}><Dimension from={0} to={100} text={`${Math.round(paidPct)}% received`} color="var(--blue)" /></div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>{outstanding > 0 && <Dimension from={0} to={100} text={`${money(outstanding)} outstanding`} />}</div>
                  </div>
                </div>

                <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", marginTop: 18, fontSize: 11, color: "var(--ink-2)" }}>
                  <span><i style={{ display: "inline-block", width: 10, height: 10, background: "var(--blue)", marginRight: 6 }} />Received</span>
                  <span><i className="hatch" style={{ display: "inline-block", width: 10, height: 10, border: "1px solid var(--rule)", marginRight: 6 }} />Not yet received</span>
                  <span><i style={{ display: "inline-block", width: 10, height: 10, background: "var(--blue-tint)", borderRight: "1.5px dashed var(--ink)", marginRight: 6 }} />Due within 30 days</span>
                  {n0(payments.OverdueCount) > 0 && (
                    <button onClick={() => navigate("/crm/payments")} style={{ color: "var(--red)", fontWeight: 600 }}>
                      ✕ {fmtInt(payments.OverdueCount)} milestone{n0(payments.OverdueCount) === 1 ? "" : "s"} overdue
                    </button>
                  )}
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="This month and next">
            {isLoading ? (<><Skel h={40} /><Skel h={40} /><Skel h={40} /></>) : (
              <div style={{ display: "grid", gap: 0 }}>
                {[
                  { label: "Units sold this month", value: fmtInt(metrics.unitsSoldThisMonth), sub: "bookings dated this month", path: "/crm/bookings" },
                  { label: "Booking value this month", value: money(metrics.revenueThisMonth), sub: "agreed value of those units", path: "/crm/bookings" },
                  { label: "Falling due in 30 days", value: money(next30), sub: `${fmtInt(metrics.forwardDueCount)} milestone${n0(metrics.forwardDueCount) === 1 ? "" : "s"}`, path: "/crm/payments" },
                ].map((s, i) => (
                  <button key={s.label} onClick={() => navigate(s.path)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: i ? "1px solid var(--rule-soft)" : 0, width: "100%" }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label link" style={{ color: "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap" }}>{s.value}</span>
                  </button>
                ))}
              </div>
            )}
          </Detail>
        </div>

        {/* C + D, beside E */}
        <div className="grid2">
          <div className="stack">
          <Detail tag="C" title="Pipeline, in section" note="Share carried to the next stage">
            {isLoading ? <Skel h={170} /> : <PipelineSection funnel={data?.funnel} onOpen={navigate} />}
          </Detail>
        <Detail tag="D" title="Seven-day lookahead" note="▲ Handover   ■ Registry   ● Payment due">
          {isLoading ? <Skel h={90} /> : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, week.length)}, minmax(96px, 1fr))`, borderLeft: "1px solid var(--rule)", minWidth: 0 }}>
                {week.map((d, i) => {
                  const h = n0(d.Handovers), r = n0(d.Registries), m = n0(d.MilestonesDue);
                  const total = h + r + m;
                  const [dow, dd, mon] = String(d.DayLabel || "").split(" ");
                  return (
                    <div key={d.DayDate || i} style={{ borderRight: "1px solid var(--rule)", padding: "4px 12px 6px", background: i === 0 ? "var(--blue-wash)" : undefined }}>
                      <div className="label" style={{ color: i === 0 ? "var(--blue)" : undefined }}>{i === 0 ? "Today" : dow}</div>
                      <div className="figure" style={{ fontSize: 22, marginTop: 4 }}>{dd}<span className="mono" style={{ fontSize: 10, fontWeight: 400, marginLeft: 5, color: "var(--graphite)" }}>{(mon || "").toUpperCase()}</span></div>
                      <div style={{ height: 4, marginTop: 9, background: "var(--rule-soft)" }}>
                        <div style={{ height: 4, width: `${(total / weekMax) * 100}%`, background: "var(--ink)" }} />
                      </div>
                      <div className="mono" style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.75, color: total ? "var(--ink)" : "var(--graphite)" }}>
                        {total === 0 ? "Nothing booked" : (
                          <>
                            {h > 0 && <button onClick={() => navigate("/crm/handover")} style={{ display: "block" }}>▲ {h} handover{h === 1 ? "" : "s"}</button>}
                            {r > 0 && <button onClick={() => navigate("/crm/sales-deed?tab=Registry")} style={{ display: "block" }}>■ {r} registr{r === 1 ? "y" : "ies"}</button>}
                            {m > 0 && <button onClick={() => navigate("/crm/payments")} style={{ display: "block" }}>● {m} payment{m === 1 ? "" : "s"} due</button>}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Detail>

          </div>

          <Detail tag="E" title="Waiting on someone" note={`${attention.open.length} open · ${attention.clear.length} clear`}>
            {isLoading ? (<><Skel h={30} /><Skel h={30} /><Skel h={30} /><Skel h={30} /></>) : attention.open.length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>Nothing is waiting. All {attention.clear.length} checks are clear.</p>
            ) : (
              <>
                {attention.open.map((a, i) => (
                  <button key={a.key} onClick={() => navigate(a.path)} className={`row${a.hot ? " hot" : ""}`}>
                    <span className="mono" style={{ fontSize: 10, color: a.hot ? "var(--red)" : "var(--graphite)" }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: a.hot ? "var(--red)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                      <span style={{ display: "block", height: 3, marginTop: 6, background: "var(--rule-soft)" }}>
                        <span className="grow" style={{ display: "block", height: 3, width: `${(a.count / attention.max) * 100}%`, background: a.hot ? "var(--red)" : "var(--blue)" }} />
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.note}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 22, textAlign: "right", color: a.hot ? "var(--red)" : "var(--ink)" }}>{fmtInt(a.count)}</span>
                  </button>
                ))}
                {attention.clear.length > 0 && (
                  <p className="mono" style={{ fontSize: 10.5, color: "var(--graphite)", margin: "12px 0 0", lineHeight: 1.7 }}>
                    Clear: {attention.clear.map((c) => c.label).join(" · ")}
                  </p>
                )}
              </>
            )}
          </Detail>
        </div>

        {/* F + G */}
        <div className="grid2">
          <Detail tag="F" title="Twelve months" note="Money on the bars, counts on the lines">
            {isLoading ? <Skel h={230} /> : trend.length === 0 ? <p style={{ fontSize: 13, color: "var(--graphite)" }}>No monthly figures yet.</p> : <TrendPlot rows={trend} />}
          </Detail>

          <Detail tag="G" title="Collection by project" note="Received against demanded">
            {isLoading ? (<><Skel h={34} /><Skel h={34} /><Skel h={34} /></>) : perProject.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No project has a demand raised yet.</p>
            ) : perProject.map((p) => {
              const pc = share(p.TotalPaid, p.TotalDue);
              return (
                <div key={p.ProjectName} style={{ padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.ProjectName || "Unnamed project"}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap" }}>{money(p.TotalPaid)} / {money(p.TotalDue)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
                    <div className="hatch" style={{ flex: 1, height: 10, border: "1px solid var(--ink)" }}>
                      <div className="grow" style={{ height: "100%", width: `${pc}%`, background: "var(--blue)" }} />
                    </div>
                    <span className="mono" style={{ width: 38, textAlign: "right", fontSize: 12, fontWeight: 600 }}>{Math.round(pc)}%</span>
                  </div>
                  {n0(p.OverdueCount) > 0 && <div className="mono" style={{ fontSize: 10.5, color: "var(--red)", marginTop: 5 }}>✕ {fmtInt(p.OverdueCount)} overdue</div>}
                </div>
              );
            })}
          </Detail>
        </div>

        {/* H: registers */}
        <Detail tag="H" title="Registers" note="Solid: settled · Hatched: in progress · Red: stopped">
          {isLoading ? (<><Skel h={40} /><Skel h={40} /></>) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0 28px" }}>
              <Register name="Applications" rows={data?.applications ?? []} onOpen={() => navigate("/crm/applications")} />
              <Register name="Bookings" rows={data?.bookings ?? []} onOpen={() => navigate("/crm/bookings")} />
              <Register name="Handovers" rows={data?.handovers ?? []} onOpen={() => navigate("/crm/handover")} />
              <Register name="Service tickets" rows={data?.serviceTickets ?? []} onOpen={() => navigate("/crm/service-tickets")} />
              <Register name="Cancellations" rows={data?.cancellations ?? []} onOpen={() => navigate("/crm/cancellations")} />
            </div>
          )}
        </Detail>
      </div>
    </div>
  );
};

export default CrmDashboard;
