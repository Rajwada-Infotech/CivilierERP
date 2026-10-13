import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SHEET_CSS, Detail, Dimension, Skel, SheetMark } from "@/components/sheet/Sheet";
import { ASSIGNMENT_STATUS_META } from "@/api/dependencyActivityAssignmentApi";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardData {
  activities: { totalCount: number; activeCount: number };
  allocations: {
    totalCount: number;
    projectCount: number;
    workerCount: number;
    todayCount: number;
    newCount: number;
  };
  labour: {
    skilledToday: number;
    unskilledToday: number;
    totalToday: number;
    crewsToday: number;
  };
  assignedWork: {
    totalCount: number;
    todayCount: number;
    pendingCount: number;
    allocatedCount?: number;
    inProgressCount: number;
    completedCount: number;
    holdCount: number;
    cancelledCount: number;
    approvedCount: number;
    reworkCount: number;
  };
  recentAssignments: {
    Id: number;
    ActivityName: string | null;
    EngineerNames: string | null;
    ChainAlias: string | null;
    ProjectName: string | null;
    Status: keyof typeof ASSIGNMENT_STATUS_META;
    UpdatedAt: string;
  }[];
  assignmentTimeline: { date: string; assigned: number; completed: number }[];
  asOf: string;
}

const EMPTY_DATA: DashboardData = {
  activities: { totalCount: 0, activeCount: 0 },
  allocations: { totalCount: 0, projectCount: 0, workerCount: 0, todayCount: 0, newCount: 0 },
  labour: { skilledToday: 0, unskilledToday: 0, totalToday: 0, crewsToday: 0 },
  assignedWork: {
    totalCount: 0,
    todayCount: 0,
    pendingCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    holdCount: 0,
    cancelledCount: 0,
    approvedCount: 0,
    reworkCount: 0,
  },
  recentAssignments: [],
  assignmentTimeline: [],
  asOf: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const n0 = (v: unknown) => Number(v) || 0;
const fmtNum = (v: unknown) => n0(v).toLocaleString("en-IN");
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

type StatusKey = keyof typeof ASSIGNMENT_STATUS_META;
type Fill = "solid" | "mid" | "hatch" | "red";

// Status order carries no workflow meaning (any status can move to any
// other — see migration 334) — this is display order only, roughly
// "least" to "most" resolved, so the bar reads left-to-right sensibly.
// How each is drawn: settled work is solid, work in hand is a lighter tone,
// work not yet moving is hatched, and cancelled work is the one red.
const STATUS_ORDER: { key: StatusKey; fill: Fill }[] = [
  { key: "PENDING", fill: "hatch" },
  { key: "ALLOCATED", fill: "mid" },
  { key: "IN_PROGRESS", fill: "mid" },
  { key: "HOLD", fill: "hatch" },
  { key: "REWORK", fill: "hatch" },
  { key: "CANCELLED", fill: "red" },
  { key: "APPROVED", fill: "solid" },
  { key: "COMPLETED", fill: "solid" },
];

const fillStyle = (fill: Fill): React.CSSProperties =>
  fill === "solid" ? { background: "var(--blue)" } : fill === "mid" ? { backgroundColor: "var(--sheet)", backgroundImage: "linear-gradient(var(--blue-mid), var(--blue-mid))" } : fill === "red" ? { background: "var(--red)" } : {};

const statusLabel = (key: StatusKey) => (ASSIGNMENT_STATUS_META[key] ?? ASSIGNMENT_STATUS_META.PENDING).label;
const statusTone = (key: StatusKey): "done" | "waiting" | "stopped" =>
  key === "COMPLETED" || key === "APPROVED" ? "done" : key === "CANCELLED" ? "stopped" : "waiting";

// ── C: fourteen days — work assigned beside work completed, day by day ──────
const FortnightPlot: React.FC<{ rows: { date: string; assigned: number; completed: number }[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 230, pad = 8, top = 24, base = 188;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => Math.max(n0(r.assigned), n0(r.completed))));
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(15, slot * 0.3);
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i className="hatch" style={{ width: 10, height: 10, border: "1px solid var(--ink)", display: "inline-block" }} /> Assigned</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Completed</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${fmtDay(active.date)} · ${fmtNum(active.assigned)} assigned · ${fmtNum(active.completed)} completed` : "Hover a day for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Work assigned and completed each day, last fourteen days" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="dpr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1" opacity="0.55" />
          </pattern>
        </defs>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{fmtNum(max)}</text>
        {rows.map((r, i) => {
          const ha = (n0(r.assigned) / max) * (base - top);
          const hc = (n0(r.completed) / max) * (base - top);
          const d = new Date(r.date);
          const on = hover == null || hover === i;
          return (
            <g key={r.date || i} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              <rect x={cx(i) - w - 1} y={base - ha} width={w} height={ha} fill="url(#dpr-hatch)" stroke="var(--ink)" strokeWidth="1" opacity={on ? 1 : 0.45} />
              <rect x={cx(i) + 1} y={base - hc} width={w} height={hc} fill="var(--blue)" fillOpacity={on ? 0.92 : 0.4} />
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{d.getDate()}</text>
              {(i === 0 || d.getDate() === 1) && (
                <text x={cx(i)} y={base + 30} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="8" letterSpacing="1" fill="var(--faint)">
                  {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
    </div>
  );
};

/** One count measured out of its total: the part in use solid, the rest hatched. */
const Measure: React.FC<{ name: string; live: number; total: number; liveWord: string; restWord: string; onOpen?: () => void }> = ({ name, live, total, liveWord, restWord, onOpen }) => {
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span className={`label ${onOpen ? "link" : ""}`} style={{ color: "var(--ink)" }}>{name}</span>
        <span>
          <span className="figure" style={{ fontSize: 22 }}>{fmtNum(live)}</span>
          <span style={{ fontSize: 12, color: "var(--graphite)", marginLeft: 6 }}>of {fmtNum(total)}</span>
        </span>
      </div>
      <div className="hatch" style={{ height: 9, marginTop: 8, border: "1px solid var(--ink)" }}>
        <div className="grow" style={{ height: "100%", width: `${share(live, total)}%`, background: "var(--blue)" }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>
        {fmtNum(live)} {liveWord} · {fmtNum(Math.max(0, total - live))} {restWord}
      </div>
    </>
  );
  const style: React.CSSProperties = { display: "block", width: "100%", padding: "11px 0", borderBottom: "1px solid var(--rule-soft)" };
  return onOpen ? <button onClick={onOpen} style={style}>{body}</button> : <div style={style}>{body}</div>;
};

// ─── Dashboard component ──────────────────────────────────────────────────────
export default function CivilWorkDprDashboard() {
  usePageRights("civilworkdpr-dashboard");
  const navigate = useNavigate();

  const { data: rawData, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ["civilWorkDprDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json().catch(() => ({}));
    },
    // "Realtime": poll every 30s so review queue / progress counts stay
    // fresh without the user manually refreshing.
    refetchInterval: 30_000, // was 10s: every open dashboard tab asked six times a minute
    refetchIntervalInBackground: false,
  });

  const data: DashboardData = { ...EMPTY_DATA, ...(rawData ?? {}) };
  const work = { ...EMPTY_DATA.assignedWork, ...(data.assignedWork ?? {}) };
  const labour = { ...EMPTY_DATA.labour, ...(data.labour ?? {}) };
  const allocations = { ...EMPTY_DATA.allocations, ...(data.allocations ?? {}) };
  const activities = { ...EMPTY_DATA.activities, ...(data.activities ?? {}) };
  const recent = data.recentAssignments ?? [];
  const timeline = data.assignmentTimeline ?? [];

  const counts: Record<StatusKey, number> = {
    PENDING: n0(work.pendingCount),
    ALLOCATED: n0(work.allocatedCount),
    IN_PROGRESS: n0(work.inProgressCount),
    HOLD: n0(work.holdCount),
    REWORK: n0(work.reworkCount),
    CANCELLED: n0(work.cancelledCount),
    APPROVED: n0(work.approvedCount),
    COMPLETED: n0(work.completedCount),
  } as Record<StatusKey, number>;
  const total = n0(work.totalCount);
  const settled = counts.COMPLETED + counts.APPROVED;
  const settledPct = share(settled, total);
  const segments = STATUS_ORDER.filter((s) => counts[s.key] > 0);
  const skilledPct = share(n0(labour.skilledToday), n0(labour.totalToday));
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const hasTimeline = timeline.some((d) => n0(d.assigned) > 0 || n0(d.completed) > 0);

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Civil Work DPR</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Site work overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Where the assigned work stands, who is on site today, and how the last fortnight of assignments ran.
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
              <button onClick={() => refetch()} disabled={isFetching} className="label link" style={{ color: "var(--blue)" }}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {isError && <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not load the site figures. Use Re-read to try again.</div>}

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Assigned work by status" note="All time">
            {isLoading ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : total === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>
                No activities are assigned yet. Assign one from an activity in Work Allocation's dependency chain.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <button onClick={() => navigate("/civilworkdpr/activity-reporting")}>
                    <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>Assigned</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(36px, 4.6vw, 62px)" }}>{fmtNum(total)}</span>
                  </button>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Completed or approved</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(36px, 4.6vw, 62px)", color: "var(--ink-2)" }}>{fmtNum(settled)}</span>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Settled</span>
                    <span className="figure" style={{ fontSize: "clamp(24px, 2.8vw, 36px)", color: "var(--blue)" }}>
                      {Math.round(settledPct)}<span style={{ fontSize: "0.5em", fontWeight: 500, marginLeft: 3 }}>%</span>
                    </span>
                  </div>
                </div>

                {/* every assignment, measured out by where it stands */}
                <div style={{ marginTop: 22 }}>
                  <div className="hatch" style={{ display: "flex", height: 30, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img"
                    aria-label={segments.map((s) => `${statusLabel(s.key)} ${counts[s.key]}`).join(", ")}>
                    {segments.map((s, i) => (
                      <div
                        key={s.key}
                        className={s.fill === "hatch" ? "" : "grow"}
                        title={`${statusLabel(s.key)}: ${fmtNum(counts[s.key])}`}
                        style={{ width: `${share(counts[s.key], total)}%`, borderLeft: i ? "1.5px solid var(--ink)" : 0, ...fillStyle(s.fill) }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex" }}>
                    <div style={{ width: `${Math.min(Math.max(100 - settledPct, 24), 76)}%`, minWidth: 0, overflow: "hidden" }}>
                      <Dimension from={0} to={100} text={`${fmtNum(total - settled)} still open`} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <Dimension from={0} to={100} text={`${fmtNum(settled)} settled`} color="var(--blue)" />
                    </div>
                  </div>
                </div>

                {/* the same, as a schedule */}
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", columnGap: 22 }}>
                  {STATUS_ORDER.map((s) => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--rule-soft)", opacity: counts[s.key] ? 1 : 0.5 }}>
                      <i className={s.fill === "hatch" ? "hatch" : ""} style={{ width: 10, height: 10, flexShrink: 0, border: `1px solid ${s.fill === "red" ? "var(--red)" : "var(--ink)"}`, ...fillStyle(s.fill) }} />
                      <span className="label" style={{ color: s.fill === "red" && counts[s.key] ? "var(--red)" : "var(--ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{statusLabel(s.key)}</span>
                      <span className="figure" style={{ fontSize: 15, color: s.fill === "red" && counts[s.key] ? "var(--red)" : undefined }}>{fmtNum(counts[s.key])}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="Today">
            {isLoading ? (<><Skel h={40} /><Skel h={40} /><Skel h={40} /></>) : (
              <div>
                <button onClick={() => navigate("/civilworkdpr/worker-attendance")} style={{ display: "block", width: "100%", paddingBottom: 14 }}>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label link" style={{ color: "var(--ink)" }}>Labour on site</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{plural(n0(labour.crewsToday), "crew")}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 34, whiteSpace: "nowrap" }}>{fmtNum(labour.totalToday)}</span>
                  </span>
                  <span className="hatch" style={{ display: "block", height: 9, marginTop: 10, border: "1px solid var(--ink)" }}>
                    <span className="grow" style={{ display: "block", height: "100%", width: `${skilledPct}%`, background: "var(--blue)" }} />
                  </span>
                  <span style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>
                    {fmtNum(labour.skilledToday)} skilled · {fmtNum(labour.unskilledToday)} unskilled
                  </span>
                </button>
                {[
                  { label: "Activities assigned today", value: n0(work.todayCount), sub: "new work given out", path: "/civilworkdpr/activity-reporting", red: false },
                  { label: "New allocations today", value: n0(allocations.todayCount), sub: "contractor allocations raised", path: "/civilworkdpr/work-allocation", red: false },
                  { label: "Unacknowledged", value: n0(allocations.newCount), sub: n0(allocations.newCount) > 0 ? "allocations nobody has picked up yet" : "every allocation has been picked up", path: "/civilworkdpr/work-allocation", red: n0(allocations.newCount) > 0 },
                ].map((s) => (
                  <button key={s.label} onClick={() => navigate(s.path)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: "1px solid var(--rule-soft)", width: "100%" }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label link" style={{ color: s.red ? "var(--red)" : "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap", color: s.red ? "var(--red)" : undefined }}>{fmtNum(s.value)}</span>
                  </button>
                ))}
              </div>
            )}
          </Detail>
        </div>

        {/* C + D */}
        <div className="grid2">
          <Detail tag="C" title="Fourteen days of assignments" note="Assigned beside completed">
            {isLoading ? <Skel h={220} /> : !hasTimeline ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No work was assigned or completed in the last fourteen days.</p>
            ) : <FortnightPlot rows={timeline} />}
          </Detail>

          <Detail tag="D" title="On the books" note="In use against held">
            {isLoading ? (<><Skel h={44} /><Skel h={44} /><Skel h={44} /></>) : (
              <>
                <Measure name="Activities" live={n0(activities.activeCount)} total={n0(activities.totalCount)} liveWord="active" restWord="inactive" onOpen={() => navigate("/masters/activity")} />
                <div style={{ padding: "13px 0", borderBottom: "1px solid var(--rule-soft)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="label" style={{ color: "var(--ink)" }}>Workers assigned</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>
                      across {plural(n0(allocations.totalCount), "allocation")} on {plural(n0(allocations.projectCount), "project")}
                    </span>
                  </span>
                  <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap" }}>{fmtNum(allocations.workerCount)}</span>
                </div>
                <div style={{ padding: "13px 0", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="label" style={{ color: "var(--ink)" }}>Work in hand</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>
                      {fmtNum(counts.PENDING)} pending · {fmtNum(counts.ALLOCATED + counts.IN_PROGRESS)} moving · {fmtNum(counts.HOLD + counts.REWORK)} held or in rework
                    </span>
                  </span>
                  <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap" }}>{fmtNum(Math.max(0, total - settled - counts.CANCELLED))}</span>
                </div>
              </>
            )}
          </Detail>
        </div>

        {/* E */}
        <Detail tag="E" title="Latest assignments" note={`${fmtNum(total)} in all`}>
          {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : recent.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>
              No activities are assigned yet. Assign one from an activity in Work Allocation's dependency chain.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 620 }}>
                <thead><tr><th>Activity</th><th>Project</th><th>Engineers</th><th>Status</th><th className="num">Updated</th></tr></thead>
                <tbody>
                  {recent.map((a) => (
                    <tr key={a.Id} className="go" onClick={() => navigate("/civilworkdpr/activity-reporting")}>
                      <td style={{ maxWidth: 280 }}>
                        <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.ActivityName || "—"}</span>
                        {a.ChainAlias && <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.ChainAlias}</span>}
                      </td>
                      <td style={{ color: "var(--ink-2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.ProjectName || "—"}</td>
                      <td style={{ color: a.EngineerNames ? "var(--ink-2)" : "var(--faint)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.EngineerNames || "Unassigned"}</td>
                      <td><SheetMark text={statusLabel(a.Status)} tone={statusTone(a.Status)} /></td>
                      <td className="num" style={{ color: "var(--ink-2)" }}>{timeAgo(a.UpdatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => navigate("/civilworkdpr/activity-reporting")} className="label link" style={{ marginTop: 14, display: "inline-block" }}>All assignments</button>
        </Detail>

        {/* F */}
        <Detail tag="F" title="Go to">
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {[
              { label: "Work allocation", path: "/civilworkdpr/work-allocation" },
              { label: "Reporting", path: "/civilworkdpr/activity-reporting" },
              { label: "Activity master", path: "/masters/activity" },
              { label: "Dependency", path: "/civilworkdpr/dependency" },
              { label: "Attendance", path: "/civilworkdpr/worker-attendance" },
            ].map((q) => (
              <button key={q.label} onClick={() => navigate(q.path)} style={{ padding: "9px 16px" }}>{q.label}</button>
            ))}
          </div>
        </Detail>
      </div>
    </div>
  );
}
