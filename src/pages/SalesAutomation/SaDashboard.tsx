import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SHEET_CSS, Detail, Dimension, Skel, n0, fmtInt, money, share } from "@/components/sheet/Sheet";
import { LEAD_CLASSIFICATIONS, LEAD_STAGES } from "@/components/sa/leadStages";
import { getStatusLabel } from "@/components/StatusBadge";

// Sales Automation dashboard, drawn on the same sheet as the CRM and Admin
// dashboards: one read-only overview of the whole module — pipeline, lead
// temperature, marketing, team and the monthly trend — on a single page.
// Nothing to set or pick; every figure links to the page that owns it.
//
// It reads the module's three summary endpoints side by side. Each section
// needs its own page right (sales: sa-leads, marketing: sa-campaigns, team:
// sa-lead-distribution); a section the user can't read says so instead of
// failing the page.

const get = async (path: string) => {
  const r = await fetchWithAuth(path);
  return r.ok ? r.json() : null;
};

const section = (key: string) => ({
  queryKey: ["sa-dashboard", key],
  queryFn: () => get(`/api/sa/dashboard/${key}`),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});

// What "Waiting on someone" checks — counts from GET /api/sa/dashboard/attention.
// Hot items are the ones costing leads right now. A null count (approvals,
// for non-admins) leaves the item out entirely.
const ATTENTION = [
  { key: "followupsOverdue", label: "Follow-ups overdue", note: "Promised call date has passed", path: "/sales-automation/followups", hot: true },
  { key: "notCalled", label: "Leads never called", note: "With a salesperson over a day, no call yet", path: "/sales-automation/leads", hot: true },
  { key: "visitsToday", label: "Site visits today", note: "Scheduled for today, not yet completed", path: "/sales-automation/site-visits", hot: false },
  { key: "toDistribute", label: "Waiting to be distributed", note: "No team lead or no salesperson yet", path: "/sales-automation/distribution", hot: false },
  { key: "tasksOverdue", label: "Tasks overdue", note: "Past their due date, not done", path: "/sales-automation/lead-tasks", hot: false },
  { key: "transfersPending", label: "Transfer requests", note: "Awaiting approval", path: "/sales-automation/lead-transfers", hot: false },
  { key: "commissionsPending", label: "Commissions to approve", note: "Pending approval", path: "/sales-automation/commissions", hot: false },
];

const FLOW = LEAD_STAGES.filter((s) => s.key !== "Lost");

const shortMonth = (ym: string) => {
  const [y, m] = String(ym).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short" });
};

const Figure: React.FC<{ label: string; value: React.ReactNode; tone?: string; small?: boolean }> = ({ label, value, tone, small }) => (
  <div>
    <span className="label" style={{ display: "block", marginBottom: 8 }}>{label}</span>
    <span className="figure" style={{ display: "block", fontSize: small ? "clamp(22px, 2.4vw, 30px)" : "clamp(32px, 4vw, 52px)", color: tone }}>{value}</span>
  </div>
);

const LineItem: React.FC<{ label: string; value: React.ReactNode; onOpen?: () => void }> = ({ label, value, onOpen }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", fontSize: 13 }}>
    {onOpen ? <button type="button" className="link" onClick={onOpen} style={{ color: "var(--ink-2)" }}>{label}</button> : <span style={{ color: "var(--ink-2)" }}>{label}</span>}
    <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
  </div>
);

const NoAccess = () => <p style={{ fontSize: 13, color: "var(--graphite)" }}>You don't have access to this section.</p>;

const SaDashboard: React.FC = () => {
  usePageRights("sa-leads");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [readAt, setReadAt] = useState(new Date());

  const sales = useQuery(section("sales"));
  const mkt = useQuery(section("marketing"));
  const team = useQuery(section("team-lead"));
  const trend = useQuery(section("trends"));
  const waiting = useQuery({ ...section("attention"), staleTime: 0 });

  useEffect(() => { setReadAt(new Date()); }, [sales.data, mkt.data, team.data]);
  const fetching = sales.isFetching || mkt.isFetching || team.isFetching || waiting.isFetching;

  const s = sales.data ?? {};
  const m = mkt.data ?? {};
  const t = team.data ?? {};
  const months: { month: string; count: number }[] = Array.isArray(trend.data) ? trend.data : [];
  const counts: Record<string, number> = s.statusCounts ?? {};
  // totalLeads includes Lost; "Active" is everything still in the flow.
  const total = n0(s.totalLeads) - n0(counts.Lost);
  const stageMax = Math.max(1, ...FLOW.map((st) => n0(counts[st.key])));
  const monthMax = Math.max(1, ...months.map((x) => n0(x.count)));
  const hot = n0(s.hotLeads), warm = n0(s.warmLeads), cold = n0(s.coldLeads);
  const classified = hot + warm + cold;
  const people: any[] = t.salespersonPerformance ?? [];

  const attention = useMemo(() => {
    const a = waiting.data ?? {};
    const items = ATTENTION.filter((i) => a[i.key] != null).map((i) => ({ ...i, count: n0(a[i.key]) }));
    const open = items.filter((i) => i.count > 0).sort((x, y) => Number(y.hot) - Number(x.hot) || y.count - x.count);
    return { open, clear: items.filter((i) => i.count === 0), max: Math.max(1, ...open.map((i) => i.count)) };
  }, [waiting.data]);

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Sales Automation"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Sales automation</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Lead &amp; campaign register</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Every lead from the ad that brought it in to the booking it became, what the marketing cost, and how the team is doing.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Date</span>
              {readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={() => qc.invalidateQueries({ queryKey: ["sa-dashboard"] })} disabled={fetching} className="label link" style={{ color: "var(--blue)" }}>
                {fetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Pipeline" note="Leads at each stage now">
            {sales.isLoading ? (<><Skel h={54} w="55%" /><Skel h={180} /></>) : !sales.data ? <NoAccess /> : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end", marginBottom: 20 }}>
                  <Figure label="Active leads" value={fmtInt(total)} />
                  <Figure label="Visits done" value={fmtInt(s.siteVisitsCompleted)} tone="var(--ink-2)" />
                  <Figure label="Booked" value={fmtInt(s.bookingsGenerated)} tone="var(--ink-2)" />
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <Figure small label="Converted" value={<>{n0(s.conversionPercentage)}<span style={{ fontSize: "0.5em", fontWeight: 500, marginLeft: 3 }}>%</span></>} tone="var(--blue)" />
                  </div>
                </div>
                {FLOW.map((st) => {
                  const n = n0(counts[st.key]);
                  return (
                    <button key={st.key} type="button" className="row" onClick={() => navigate(st.path)} style={{ gridTemplateColumns: "120px minmax(0, 1fr) 48px", padding: "5px 0" }}>
                      <span style={{ fontSize: 13, textAlign: "left", color: n ? "var(--ink)" : "var(--graphite)" }}>{st.label}</span>
                      <span style={{ height: 10, background: "var(--rule-soft)" }}>
                        <span className="grow" style={{ display: "block", height: 10, width: `${(n / stageMax) * 100}%`, background: "var(--blue)" }} />
                      </span>
                      <span className="mono num" style={{ fontSize: 13, fontWeight: 600, color: n ? "var(--ink)" : "var(--graphite)" }}>{fmtInt(n)}</span>
                    </button>
                  );
                })}
                <p style={{ marginTop: 12, fontSize: 12, color: "var(--graphite)" }}>
                  <button type="button" className="link" onClick={() => navigate("/sales-automation/leads")}>{fmtInt(counts.Lost)} lost</button>
                  {" "}· not counted in the stages above
                </p>
              </>
            )}
          </Detail>

          <div className="stack">
            <Detail tag="B" title="Waiting on someone" note={`${attention.open.length} open · ${attention.clear.length} clear`}>
              {waiting.isLoading ? (<><Skel h={30} /><Skel h={30} /><Skel h={30} /></>) : !waiting.data ? <NoAccess /> : attention.open.length === 0 ? (
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
            <Detail tag="C" title="Lead temperature" note={`${fmtInt(classified)} classified`}>
              {sales.isLoading ? <Skel h={60} /> : !sales.data ? <NoAccess /> : (
                <>
                  {/* Plain empty bar when nothing is classified — hatching on a sheet means "in progress". */}
                  <div style={{ display: "flex", height: 26, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img" aria-label={`${hot} hot, ${warm} warm, ${cold} cold`}>
                    {classified > 0 && <>
                      <div className="grow" style={{ width: `${share(hot, classified)}%`, background: "var(--red)" }} />
                      <div className="grow" style={{ width: `${share(warm, classified)}%`, background: "var(--blue)" }} />
                      <div className="grow" style={{ width: `${share(cold, classified)}%`, background: "var(--blue-tint)" }} />
                    </>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
                    <Figure small label="Hot" value={fmtInt(hot)} tone={hot ? "var(--red)" : "var(--graphite)"} />
                    <Figure small label="Warm" value={fmtInt(warm)} tone={warm ? "var(--ink)" : "var(--graphite)"} />
                    <Figure small label="Cold" value={fmtInt(cold)} tone={cold ? "var(--ink)" : "var(--graphite)"} />
                  </div>
                  {(() => {
                    const others = LEAD_CLASSIFICATIONS.filter((c) => !["Hot", "Warm", "Cold"].includes(c));
                    const cc: Record<string, number> = s.classCounts ?? {};
                    const unset = Math.max(0, n0(s.totalLeads) - Object.values(cc).reduce((a, b) => a + n0(b), 0));
                    return (
                      <p style={{ marginTop: 12, fontSize: 12, color: "var(--graphite)" }}>
                        {others.map((c) => `${fmtInt(cc[c])} ${getStatusLabel(c).toLowerCase()}`).join(" · ")} · {fmtInt(unset)} not yet rated
                      </p>
                    );
                  })()}
                </>
              )}
            </Detail>
          </div>
        </div>

        {/* D + E */}
        <div className="grid2">
          <Detail tag="D" title="Marketing" note="All time">
            {mkt.isLoading ? (<><Skel h={54} w="60%" /><Skel h={120} /></>) : !mkt.data ? <NoAccess /> : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end", marginBottom: 16 }}>
                  <Figure label="Spent" value={money(m.marketingSpend)} />
                  <Figure small label="Per lead" value={money(m.costPerLead)} tone="var(--ink-2)" />
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <Figure small label="Return" value={<>{n0(m.roi)}<span style={{ fontSize: "0.5em", fontWeight: 500, marginLeft: 3 }}>%</span></>} tone={n0(m.roi) < 0 ? "var(--red)" : "var(--blue)"} />
                  </div>
                </div>
                {n0(m.revenueGenerated) + n0(m.marketingSpend) > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <Dimension from={0} to={share(m.marketingSpend, Math.max(n0(m.marketingSpend), n0(m.revenueGenerated)))} text={`${money(m.marketingSpend)} spent`} />
                    <Dimension from={0} to={share(m.revenueGenerated, Math.max(n0(m.marketingSpend), n0(m.revenueGenerated)))} text={`${money(m.revenueGenerated)} booked`} color="var(--blue)" />
                  </div>
                )}
                <LineItem label="Campaigns" value={fmtInt(m.totalCampaigns)} onOpen={() => navigate("/sales-automation/campaigns")} />
                <LineItem label="Ads running" value={fmtInt(m.activeAds)} onOpen={() => navigate("/sales-automation/ads")} />
                <LineItem label="Invoices paid" value={money(m.invoicedPaid)} onOpen={() => navigate("/sales-automation/invoices")} />
              </>
            )}
          </Detail>

          <Detail tag="E" title="Best performers" note="By leads brought in">
            {mkt.isLoading ? (<><Skel h={40} /><Skel h={40} /></>) : !mkt.data ? <NoAccess /> : (
              <>
                {[
                  { kind: "Campaign", row: m.bestCampaign, extra: m.bestCampaign?.CampaignCode, path: "/sales-automation/campaigns" },
                  { kind: "Ad", row: m.bestAd, extra: null, path: "/sales-automation/ads" },
                ].map((b) => (
                  <div key={b.kind} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                    <span className="label">{b.kind}</span>
                    {n0(b.row?.LeadCount) > 0 ? (
                      <button type="button" onClick={() => navigate(b.path)} style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 4, textAlign: "left" }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{b.row.Name}{b.extra && <span className="mono" style={{ fontSize: 11, color: "var(--graphite)", marginLeft: 8 }}>{b.extra}</span>}</span>
                        <span className="mono" style={{ fontSize: 13 }}>{fmtInt(b.row.LeadCount)} leads</span>
                      </button>
                    ) : <p style={{ fontSize: 13, color: "var(--graphite)", marginTop: 4 }}>None has brought in a lead yet.</p>}
                  </div>
                ))}
              </>
            )}
          </Detail>
        </div>

        {/* F + G */}
        <div className="grid2">
          <Detail tag="F" title="Team" note={`${fmtInt(people.length)} salespeople`}>
            {team.isLoading ? (<><Skel h={40} /><Skel h={120} /></>) : !team.data ? <NoAccess /> : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", marginBottom: 16 }}>
                  <Figure small label="With team leads" value={fmtInt(t.leadsReceived)} />
                  <Figure small label="With salespeople" value={fmtInt(t.leadsAssigned)} tone="var(--ink-2)" />
                  <Figure small label="Waiting" value={fmtInt(t.pendingDistribution)} tone={n0(t.pendingDistribution) ? "var(--red)" : "var(--graphite)"} />
                </div>
                {people.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--graphite)" }}>No salesperson has leads yet.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="mono" style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                      <thead>
                        <tr className="label" style={{ textAlign: "right" }}>
                          {["Salesperson", "Leads", "Calls", "Visits", "Booked", "Conv."].map((h, i) => (
                            <th key={h} style={{ padding: "6px 0", textAlign: i === 0 ? "left" : "right", fontWeight: 600, borderBottom: "1px solid var(--ink)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p) => (
                          <tr key={p.userId} style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                            <td style={{ padding: "7px 0", fontFamily: "Sora, sans-serif", fontWeight: 600 }}>{p.userName}</td>
                            <td className="num">{fmtInt(p.leadsAssigned)}</td>
                            <td className="num">{fmtInt(p.callsMade)}</td>
                            <td className="num">{fmtInt(p.siteVisits)}</td>
                            <td className="num">{fmtInt(p.bookings)}</td>
                            <td className="num">{n0(p.conversionRate)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Detail>

          <Detail tag="G" title="Leads per month" note="Last six months">
            {trend.isLoading ? <Skel h={150} /> : !trend.data ? <NoAccess /> : months.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)" }}>No leads in the last six months.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, gap: 10, alignItems: "end", height: 160 }}>
                {months.map((x) => (
                  <div key={x.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{fmtInt(x.count)}</span>
                    <div style={{ width: "100%", height: `${Math.max(2, (n0(x.count) / monthMax) * 110)}px`, background: "var(--blue)", border: "1px solid var(--ink)" }} />
                    <span className="label">{shortMonth(x.month)}</span>
                  </div>
                ))}
              </div>
            )}
          </Detail>
        </div>
      </div>
    </div>
  );
};

export default SaDashboard;
