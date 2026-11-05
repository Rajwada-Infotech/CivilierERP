import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Skel, SheetMark } from "@/components/sheet/Sheet";
import { getSystemMetrics, type SystemMetrics } from "@/api/metricsApi";

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v || 0)) * 100);
const size = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${fmtNum(kb)} KB`);
const uptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

const MODULES: { key: keyof NonNullable<SystemMetrics["modules"]>; label: string }[] = [
  { key: "purchaseOrders", label: "Purchase orders" },
  { key: "workOrders", label: "Work orders" },
  { key: "expenseBooking", label: "Expense bookings" },
];

/** Requests per minute, averaged over each of the last twelve hours. */
const HourPlot: React.FC<{ rows: { label: string; rpm: number }[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, pad = 8, top = 24, base = 184;
  const slot = (W - pad * 2) / Math.max(1, rows.length);
  const max = Math.max(1, ...rows.map((r) => r.rpm));
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(34, slot * 0.5);
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Requests a minute</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${active.label} · ${fmtNum(active.rpm)} a minute · about ${fmtNum(active.rpm * 60)} that hour` : "Hover an hour for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Requests a minute, each of the last twelve hours" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{fmtNum(max)}</text>
        {rows.map((r, i) => {
          const h = (r.rpm / max) * (base - top);
          const on = hover == null || hover === i;
          const last = i === rows.length - 1;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              {r.rpm > 0 ? (
                <rect x={cx(i) - w / 2} y={base - h} width={w} height={h} fill="var(--blue)" fillOpacity={on ? (last ? 0.55 : 0.92) : 0.4} />
              ) : (
                <text x={cx(i)} y={base - 6} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--faint)">—</text>
              )}
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" letterSpacing="1" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{r.label.slice(0, 2)}</text>
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
      <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>The last bar is the hour still running, drawn lighter.</p>
    </div>
  );
};

const Row: React.FC<{ label: string; sub?: string; children: React.ReactNode }> = ({ label, sub, children }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: "1px solid var(--rule-soft)" }}>
    <span style={{ minWidth: 0 }}>
      <span className="label" style={{ color: "var(--ink)" }}>{label}</span>
      {sub && <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{sub}</span>}
    </span>
    <span style={{ whiteSpace: "nowrap" }}>{children}</span>
  </div>
);

const MetricsDashboard = () => {
  usePageRights("admin-dashboard");
  const [live, setLive] = useState(true);

  const { data: m, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["system-metrics", "live"],
    queryFn: getSystemMetrics,
    refetchInterval: live ? 10_000 : false,
    refetchIntervalInBackground: false,
  });

  const hourLabels = Array.from({ length: 12 }, (_, i) => `${String((new Date().getHours() - 11 + i + 24) % 24).padStart(2, "0")}:00`);
  const hours = hourLabels.map((label, i) => ({ label, rpm: Number(m?.rpmHistory?.[i] || 0) }));
  const hasHours = hours.some((h) => h.rpm > 0);
  const topUsers = (m?.topEngagedUsers || []).reduce<{ name: string; score: number }[]>((acc, v, i, all) => {
    if (i % 2 === 0) acc.push({ name: v || "Unknown", score: parseFloat(all[i + 1] || "0") });
    return acc;
  }, []);
  const maxScore = Math.max(1, ...topUsers.map((u) => u.score));
  const tables = m?.tables || [];
  const maxRows = Math.max(1, ...tables.map((t) => t.rows));
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const cacheLow = !!m && m.cacheHitRate > 0 && m.cacheHitRate < 0.7;
  const memHigh = !!m && m.memoryUsage > 0.85;

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Admin", "Live Metrics"]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Admin</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Live metrics</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              How hard the server is working right now, whether its parts are healthy, and what the database holds.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>
                <span className="label" style={{ display: "block", marginBottom: 5 }}>Reading</span>
                <SheetMark text={live ? "Live · every 10 s" : "Paused"} tone={live ? "done" : "waiting"} />
              </span>
              <button onClick={() => setLive((v) => !v)} className="label link" style={{ color: "var(--blue)" }}>
                {live ? "Pause" : "Resume"}
              </button>
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={() => refetch()} disabled={isFetching} className="label link" style={{ color: "var(--blue)" }}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {isError && <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not read the metrics. Use Re-read to try again.</div>}

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Right now">
            {isLoading || !m ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Requests this minute</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(28px, 3.6vw, 48px)" }}>{fmtNum(m.rpm)}</span>
                  </div>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>People in today</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(28px, 3.6vw, 48px)", color: "var(--ink-2)" }}>{fmtNum(m.activeUsers)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 18 }}>
                  {[
                    { label: "Cache hit rate", sub: cacheLow ? "below 70% — cached answers are expiring too soon" : "share of reads answered from the cache", v: m.cacheHitRate, red: cacheLow },
                    { label: "Redis memory", sub: memHigh ? "nearly full — older cache entries will be evicted" : "used of Redis's memory limit", v: m.memoryUsage, red: memHigh },
                  ].map((g) => (
                    <div key={g.label} style={{ padding: "11px 0", borderTop: "1px solid var(--rule-soft)" }}>
                      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                        <span className="label" style={{ color: g.red ? "var(--red)" : "var(--ink)" }}>{g.label}</span>
                        <span className="figure" style={{ fontSize: 22, color: g.red ? "var(--red)" : undefined }}>{pct(g.v)}<span style={{ fontSize: "0.55em", fontWeight: 500, marginLeft: 2 }}>%</span></span>
                      </span>
                      <span className="hatch" style={{ display: "block", height: 8, marginTop: 8, border: "1px solid var(--ink)" }}>
                        <span className="grow" style={{ display: "block", height: "100%", width: `${pct(g.v)}%`, background: g.red ? "var(--red)" : "var(--blue)" }} />
                      </span>
                      <span style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>{g.sub}</span>
                    </div>
                  ))}
                  {m.users && (
                    <Row label="Accounts" sub={`${fmtNum(m.users.inactive)} discontinued`}>
                      <span className="figure" style={{ fontSize: 22 }}>{fmtNum(m.users.active)}</span>
                    </Row>
                  )}
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="Health">
            {isLoading || !m ? (<><Skel h={34} /><Skel h={34} /><Skel h={34} /></>) : (
              <div>
                {[
                  { label: "Redis", sub: "cache, rate limits and these counters", ok: m.redisOk },
                  { label: "Background worker", sub: "queued jobs such as notifications", ok: m.workerOk },
                  { label: "Persistence", sub: "Redis's last save to disk", ok: m.aofOk },
                ].map((h) => (
                  <Row key={h.label} label={h.label} sub={h.sub}>
                    <SheetMark text={h.ok ? "Running" : "Down"} tone={h.ok ? "done" : "stopped"} />
                  </Row>
                ))}
                {m.server && (
                  <>
                    <Row label="Server up for" sub={`${m.server.environment} · Node ${m.server.nodeVersion}`}>
                      <span className="figure" style={{ fontSize: 20 }}>{uptime(m.server.uptimeSeconds)}</span>
                    </Row>
                    <Row label="Server memory" sub={`${fmtNum(m.server.heapUsedMB)} MB of it in use by the app`}>
                      <span className="figure" style={{ fontSize: 20 }}>{fmtNum(m.server.rssMemoryMB)} MB</span>
                    </Row>
                  </>
                )}
              </div>
            )}
          </Detail>
        </div>

        {/* C */}
        <Detail tag="C" title="Twelve hours of traffic" note="Average requests a minute, each hour">
          {isLoading ? <Skel h={210} /> : !hasHours ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No traffic is counted for the last twelve hours yet.</p>
          ) : <HourPlot rows={hours} />}
        </Detail>

        {/* D + E */}
        <div className="grid2">
          <Detail tag="D" title="Most engaged" note="By activity score">
            {isLoading ? (<><Skel h={24} /><Skel h={24} /><Skel h={24} /></>) : topUsers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No activity has been scored yet.</p>
            ) : (
              <div>
                {topUsers.slice(0, 8).map((u, i) => (
                  <div key={`${u.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                    <span className="label" style={{ width: 18 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                    <span className="hatch" style={{ display: "block", width: 90, height: 7, border: "1px solid var(--ink)" }}>
                      <span style={{ display: "block", height: "100%", width: `${(u.score / maxScore) * 100}%`, background: "var(--blue)" }} />
                    </span>
                    <span className="figure" style={{ fontSize: 14, minWidth: 44, textAlign: "right" }}>{fmtNum(Math.round(u.score))}</span>
                  </div>
                ))}
              </div>
            )}
          </Detail>

          <Detail tag="E" title="Documents by status">
            {isLoading || !m ? (<><Skel h={24} /><Skel h={24} /><Skel h={24} /></>) : (
              <div style={{ display: "grid", gap: 16 }}>
                {MODULES.map(({ key, label }) => {
                  const rows = m.modules?.[key] || [];
                  const total = rows.reduce((s, r) => s + r.count, 0);
                  return (
                    <div key={key}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                        <span className="label" style={{ color: "var(--ink)" }}>{label}</span>
                        <span className="figure" style={{ fontSize: 15 }}>{fmtNum(total)}</span>
                      </div>
                      {total === 0 ? (
                        <span style={{ fontSize: 12, color: "var(--faint)" }}>None yet</span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                          {rows.map((r) => (
                            <span key={r.status} style={{ fontSize: 12, color: "var(--graphite)" }}>
                              {r.status} <span style={{ color: "var(--ink)", fontWeight: 600 }}>{fmtNum(r.count)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Detail>
        </div>

        {/* F */}
        <Detail tag="F" title="Largest tables" note="By rows">
          {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : tables.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No table sizes were returned.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 560 }}>
                <thead><tr><th>Table</th><th>Share of rows</th><th className="num">Rows</th><th className="num">On disk</th></tr></thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.name}>
                      <td style={{ color: "var(--ink)" }}>{t.name}</td>
                      <td style={{ width: 200 }}>
                        <span className="hatch" style={{ display: "block", height: 7, border: "1px solid var(--ink)" }}>
                          <span style={{ display: "block", height: "100%", width: `${(t.rows / maxRows) * 100}%`, background: "var(--blue)" }} />
                        </span>
                      </td>
                      <td className="num"><span className="figure" style={{ fontSize: 14 }}>{fmtNum(t.rows)}</span></td>
                      <td className="num" style={{ color: "var(--ink-2)" }}>{size(t.totalKB)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Detail>
      </div>
    </div>
  );
};

export default MetricsDashboard;
