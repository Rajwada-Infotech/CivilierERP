import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable } from "@/components/ui/DataTable";
import { SHEET_CSS, Detail, Skel, statusTone } from "@/components/sheet/Sheet";
import { type EngineeringDashboardData, type StatusRow, normalise, fmt, fmtNum, share, WO_COLS, BOQ_COLS, WD_COLS } from "./dashboard/shared";
import { FortnightPlot } from "./dashboard/FortnightPlot";

type Recent = "wos" | "boqs" | "wds";

const RECENT: Record<Recent, { label: string; path: string; key: keyof EngineeringDashboardData; cols: any; empty: string }> = {
  wos: { label: "Work orders", path: "/engineering/work-order", key: "recentWOs", cols: WO_COLS, empty: "No work orders yet." },
  boqs: { label: "BOQs", path: "/engineering/boq", key: "recentBOQs", cols: BOQ_COLS, empty: "No BOQs yet." },
  wds: { label: "Work done", path: "/engineering/work-done", key: "recentWorkDone", cols: WD_COLS, empty: "No work done entries yet." },
};

const SHORTCUTS = [
  { label: "Work orders", path: "/engineering/work-order" },
  { label: "BOQ", path: "/engineering/boq" },
  { label: "Work done", path: "/engineering/work-done" },
];

const fillFor = (status: string): React.CSSProperties => {
  const tone = statusTone(status);
  return tone === "done" ? { background: "var(--blue)" } : tone === "stopped" ? { background: "var(--red)" } : {};
};

function StatusList({ rows, empty, unit }: { rows: StatusRow[]; empty: string; unit: string }) {
  const total = rows.reduce((s, r) => s + Number(r.Count), 0);
  if (!rows.length) return <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{empty}</p>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.Status} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
          <i className={statusTone(r.Status || "Draft") === "waiting" ? "hatch" : ""} style={{ width: 10, height: 10, flexShrink: 0, border: "1px solid var(--ink)", ...fillFor(r.Status || "Draft") }} />
          <span className="label" style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}>{r.Status || "Draft"}</span>
          <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
            {fmtNum(Number(r.Count))} · {Math.round(share(Number(r.Count), total))}%
          </span>
          <span className="figure" style={{ fontSize: 15, minWidth: 110, textAlign: "right" }}>{fmt(Number(r.TotalValue))}</span>
        </div>
      ))}
      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>{fmtNum(total)} {unit} in all</p>
    </div>
  );
}

export default function EngineeringDashboard() {
  usePageRights("engineering-dashboard");
  const navigate = useNavigate();
  const [recent, setRecent] = useState<Recent>("wos");

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<EngineeringDashboardData>({
    queryKey: ["engineering-dashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/engineering/dashboard");
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? b?.message ?? `Request failed (${res.status})`);
      }
      return normalise(await res.json().catch(() => ({})));
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const d = data;
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();

  const figures: { path?: string; label: string; value: string; sub: string }[] = d
    ? [
        { path: "/engineering/work-order", label: "Work orders", value: fmtNum(d.workOrders.total), sub: `${fmtNum(d.workOrders.thisMonth)} raised this month` },
        { path: "/engineering/work-order", label: "Not yet approved", value: fmtNum(d.workOrders.open), sub: "work orders in draft or awaiting approval" },
        { path: "/engineering/work-order", label: "Work order value", value: fmt(d.workOrders.totalValue), sub: "rejected ones left out" },
        { path: "/engineering/boq", label: "BOQ value", value: fmt(d.boq.totalValue), sub: `${fmtNum(d.boq.total)} BOQs · ${fmtNum(d.boq.approved)} approved` },
        { path: "/engineering/work-done", label: "Work done certified", value: fmt(d.workDone.certifiedAmount), sub: "approved entries only" },
        { path: "/engineering/work-done", label: "Work done awaiting approval", value: fmtNum(d.workDone.pending), sub: `of ${fmtNum(d.workDone.total)} entries` },
        { label: "Active projects", value: fmtNum(d.projects.active), sub: `${fmtNum(d.projects.total)} projects in all` },
      ]
    : [];

  // The three values against each other, measured on the largest.
  const values = d
    ? [
        { label: "BOQ", sub: "estimated", value: d.boq.totalValue, fill: { background: "var(--blue)" } as React.CSSProperties },
        { label: "Work orders", sub: "contracted", value: d.workOrders.totalValue, fill: { background: "var(--blue)", opacity: 0.6 } as React.CSSProperties },
        { label: "Work done", sub: "certified", value: d.workDone.certifiedAmount, fill: { background: "var(--ink)" } as React.CSSProperties },
      ]
    : [];
  const maxValue = Math.max(1, ...values.map((v) => v.value));
  const hasTimeline = !!d && d.timeline.some((t) => t.workOrders > 0 || t.workDone > 0);
  const recentRows = (d?.[RECENT[recent].key] as any[]) ?? [];

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Engineering"]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Engineering</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Engineering overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              What has been estimated, contracted and certified across your projects, and what is still waiting for approval.
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

        {isError && !d && (
          <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>
            Could not load the engineering figures{(error as Error)?.message ? ` (${(error as Error).message})` : ""}. Use Re-read to try again.
          </div>
        )}

        {/* A — figures */}
        <Detail tag="A" title="Right now" note="Open a figure for its register">
          {isLoading ? (
            <div className="grid4" style={{ gap: 16 }}>{Array.from({ length: 7 }).map((_, i) => <Skel key={i} h={58} />)}</div>
          ) : (
            <div className="grid4" style={{ rowGap: 22, columnGap: 24 }}>
              {figures.map((f) => (
                <button key={f.label} onClick={() => f.path && navigate(f.path)} disabled={!f.path} style={{ textAlign: "left", minWidth: 0, cursor: f.path ? "pointer" : "default" }}>
                  <span className={`label${f.path ? " link" : ""}`} style={{ display: "inline-block", marginBottom: 8 }}>{f.label}</span>
                  <span className="figure" style={{ display: "block", fontSize: "clamp(22px, 2.4vw, 32px)" }}>{f.value}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{f.sub}</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* B + C */}
        <div className="grid2">
          <Detail tag="B" title="Estimated, contracted, certified">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : (
              <div>
                {values.map((v) => (
                  <div key={v.label} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                    <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span>
                        <span className="label" style={{ color: "var(--ink)" }}>{v.label}</span>
                        <span style={{ fontSize: 11.5, color: "var(--graphite)", marginLeft: 8 }}>{v.sub}</span>
                      </span>
                      <span className="figure" style={{ fontSize: 18, whiteSpace: "nowrap" }}>{fmt(v.value)}</span>
                    </span>
                    <span className="hatch" style={{ display: "block", height: 9, marginTop: 7, border: "1px solid var(--ink)" }}>
                      <span className="grow" style={{ display: "block", height: "100%", width: `${share(v.value, maxValue)}%`, ...v.fill }} />
                    </span>
                  </div>
                ))}
                <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>
                  {Math.round(share(d.workDone.certifiedAmount, d.workOrders.totalValue))}% of the contracted value has been certified as done.
                </p>
              </div>
            )}
          </Detail>

          <Detail tag="C" title="Work orders by status">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /></>) : (
              <StatusList rows={d.woStatusBreakdown} empty="No work orders yet." unit="work orders" />
            )}
          </Detail>
        </div>

        {/* D */}
        <Detail tag="D" title="Fourteen days" note="Work order value raised and work done certified each day">
          {isLoading ? <Skel h={220} /> : !hasTimeline ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No work orders were raised and no work done was certified in the last fourteen days.</p>
          ) : <FortnightPlot rows={d!.timeline} />}
        </Detail>

        {/* E */}
        <Detail tag="E" title="Work done by status">
          {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /></>) : (
            <StatusList rows={d.workDoneStatusBreakdown} empty="No work done entries yet." unit="entries" />
          )}
        </Detail>

        {/* F — latest documents */}
        <section className="cell">
          <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span className="tag">F</span>
            <h2 className="label" style={{ color: "var(--ink)", margin: 0 }}>Latest documents</h2>
            <span style={{ flex: 1, height: 1, background: "var(--rule)", minWidth: 20 }} />
            <span className="seg noscroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
              {(Object.keys(RECENT) as Recent[]).map((k) => (
                <button key={k} className={recent === k ? "on" : ""} aria-pressed={recent === k} onClick={() => setRecent(k)}>{RECENT[k].label}</button>
              ))}
            </span>
          </header>
          {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : recentRows.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{RECENT[recent].empty}</p>
          ) : (
            <DataTable data={recentRows} columns={RECENT[recent].cols} searchable={false} paginated={false} emptyMessage={RECENT[recent].empty} />
          )}
          <button onClick={() => navigate(RECENT[recent].path)} className="label link" style={{ marginTop: 12, color: "var(--blue)" }}>
            All {RECENT[recent].label.toLowerCase()} →
          </button>
        </section>

        {/* G — shortcuts */}
        <Detail tag="G" title="Go to">
          <div className="grid4" style={{ gap: 0 }}>
            {SHORTCUTS.map((s) => (
              <button key={s.path} onClick={() => navigate(s.path)} className="row"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 10px", borderBottom: "1px solid var(--rule-soft)" }}>
                <span className="label link" style={{ color: "var(--ink)" }}>{s.label}</span>
                <span style={{ color: "var(--graphite)", fontSize: 13 }}>→</span>
              </button>
            ))}
          </div>
        </Detail>
      </div>
    </div>
  );
}
