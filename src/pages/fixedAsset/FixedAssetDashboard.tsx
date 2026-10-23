import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Skel, statusTone } from "@/components/sheet/Sheet";
import { type Breakdown, type FixedAssetDashboardData, getFixedAssetDashboard, fmt, fmtNum, share, monthName, dayName, whenName } from "./dashboard/shared";
import { YearPlot } from "./dashboard/YearPlot";

// Every page of the module (same routes as the Fixed Asset sidebar).
const SHORTCUTS = [
  { label: "Asset register", path: "/fixed-asset/record" },
  { label: "FA inventory", path: "/fixed-asset/tagging" },
  { label: "FA code stickers", path: "/fixed-asset/depreciation-tag-stickers" },
  { label: "Inventory import", path: "/fixed-asset/inventory-import" },
  { label: "Assignment", path: "/fixed-asset/assignment" },
  { label: "User-wise transfer", path: "/fixed-asset/transfer" },
  { label: "Owner & quality check", path: "/fixed-asset/quality-check" },
  { label: "Maintenance & repair", path: "/fixed-asset/maintenance" },
  { label: "Depreciation generate", path: "/fixed-asset/depreciation-generate" },
  { label: "Depreciation setup", path: "/fixed-asset/depreciation-setup" },
];

// The sheet's .row is a grid, which breaks a table row; table rows get their own hover.
const RECENT_CSS = ".crm-sheet tr.fa-recent:hover td { background: var(--blue-wash); }";

const fillFor = (status: string): React.CSSProperties => {
  const tone = statusTone(status);
  return tone === "done" ? { background: "var(--blue)" } : tone === "stopped" ? { background: "var(--red)" } : {};
};

const empty = (text: string) => <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{text}</p>;

/** Cost and what is left of it after depreciation, one pair of bars per line, measured on the largest cost. */
function CostBars({ rows, emptyText }: { rows: Breakdown[]; emptyText: string }) {
  if (!rows.length) return empty(emptyText);
  const max = Math.max(1, ...rows.map((r) => r.cost));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.name} style={{ padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span className="label" style={{ color: "var(--ink)" }}>{r.name}</span>
              <span style={{ fontSize: 11.5, color: "var(--graphite)", marginLeft: 8 }}>{fmtNum(r.count)} {r.count === 1 ? "asset" : "assets"}</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
              <span className="figure" style={{ fontSize: 15, color: "var(--ink)" }}>{fmt(r.bookValue)}</span> of {fmt(r.cost)}
            </span>
          </span>
          <span className="hatch" style={{ display: "block", position: "relative", height: 9, marginTop: 7, width: `${share(r.cost, max)}%`, minWidth: 2, border: "1px solid var(--ink)" }}>
            <span className="grow" style={{ display: "block", height: "100%", width: `${share(r.bookValue, r.cost)}%`, background: "var(--blue)" }} />
          </span>
        </div>
      ))}
      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> book value</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i className="hatch" style={{ width: 10, height: 10, border: "1px solid var(--ink)", display: "inline-block" }} /> depreciated</span>
      </p>
    </div>
  );
}

function StatusList({ rows, total, unit, money }: { rows: { status: string; count: number; cost?: number }[]; total: number; unit: string; money?: boolean }) {
  if (!rows.length) return empty(`No ${unit} yet.`);
  return (
    <div>
      {rows.map((r) => (
        <div key={r.status} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
          <i className={statusTone(r.status || "Draft") === "waiting" ? "hatch" : ""} style={{ width: 10, height: 10, flexShrink: 0, border: "1px solid var(--ink)", ...fillFor(r.status || "Draft") }} />
          <span className="label" style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}>{r.status || "Not set"}</span>
          <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
            {money ? `${fmtNum(r.count)} · ` : ""}{Math.round(share(r.count, total))}%
          </span>
          <span className="figure" style={{ fontSize: 15, minWidth: money ? 110 : 50, textAlign: "right" }}>{money ? fmt(r.cost ?? 0) : fmtNum(r.count)}</span>
        </div>
      ))}
      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>{fmtNum(total)} {unit} in all</p>
    </div>
  );
}

export default function FixedAssetDashboard() {
  usePageRights("fixed-asset-dashboard");
  const navigate = useNavigate();

  const { data: d, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<FixedAssetDashboardData>({
    queryKey: ["fixed-asset-dashboard"],
    queryFn: getFixedAssetDashboard,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const fy = d ? `since ${dayName(d.fyStart)}` : "";

  const figures: { path: string; label: string; value: string; sub: string; warn?: boolean }[] = d
    ? [
        { path: "/fixed-asset/record", label: "Assets in the register", value: fmtNum(d.register.assets), sub: `${fmtNum(d.register.addedThisYear)} added this year · ${fmt(d.register.addedThisYearCost)}` },
        { path: "/fixed-asset/record", label: "Book value", value: fmt(d.register.bookValue), sub: `of ${fmt(d.register.cost)} cost, after ${fmt(d.register.depreciated)} depreciation` },
        { path: "/fixed-asset/depreciation-generate", label: "Depreciation this year", value: fmt(d.depreciation.thisYear), sub: d.depreciation.lastPeriod ? `last posted for ${monthName(d.depreciation.lastPeriod)}` : "none posted yet" },
        { path: "/fixed-asset/tagging", label: "Waiting for codes", value: fmtNum(d.inventory.untaggedQty), sub: `in ${fmtNum(d.inventory.untaggedBatches)} untagged ${d.inventory.untaggedBatches === 1 ? "batch" : "batches"}`, warn: d.inventory.untaggedQty > 0 },
        { path: "/fixed-asset/assignment", label: "Without a user", value: fmtNum(d.assignment.unassigned), sub: `${fmtNum(d.assignment.assigned)} assigned`, warn: d.assignment.unassigned > 0 },
        { path: "/fixed-asset/quality-check", label: "Follow-ups overdue", value: fmtNum(d.qualityCheck.overdue), sub: `${fmtNum(d.qualityCheck.dueThisWeek)} due this week · ${fmtNum(d.qualityCheck.followUpsOpen)} open`, warn: d.qualityCheck.overdue > 0 },
        { path: "/fixed-asset/maintenance", label: "Maintenance this year", value: fmt(d.maintenance.spentThisYear), sub: `${fmtNum(d.maintenance.thisYear)} jobs · ${fmtNum(d.maintenance.notPosted)} not posted` },
        { path: "/fixed-asset/inventory-import", label: "Imported", value: fmtNum(d.imports.qty), sub: `${fmtNum(d.imports.count)} imports · ${fmt(d.imports.value)}${d.imports.lastDate ? ` · last ${dayName(d.imports.lastDate)}` : ""}` },
      ]
    : [];

  // What someone should do next, only the lines that apply.
  const attention: { path: string; text: string }[] = d
    ? [
        d.depreciation.dueLastMonth > 0 && { path: "/fixed-asset/depreciation-generate", text: `${new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}'s depreciation is not posted for ${fmtNum(d.depreciation.dueLastMonth)} active ${d.depreciation.dueLastMonth === 1 ? "asset" : "assets"}.` },
        d.inventory.untaggedBatches > 0 && { path: "/fixed-asset/tagging", text: `${fmtNum(d.inventory.untaggedQty)} received items in ${fmtNum(d.inventory.untaggedBatches)} ${d.inventory.untaggedBatches === 1 ? "batch have" : "batches have"} no asset code yet.` },
        d.inventory.noTemplate > 0 && { path: "/fixed-asset/tagging", text: `${fmtNum(d.inventory.noTemplate)} untagged ${d.inventory.noTemplate === 1 ? "batch has" : "batches have"} no code template, so codes cannot be made for ${d.inventory.noTemplate === 1 ? "it" : "them"}.` },
        d.assignment.unassigned > 0 && { path: "/fixed-asset/assignment", text: `${fmtNum(d.assignment.unassigned)} ${d.assignment.unassigned === 1 ? "asset has" : "assets have"} no user.` },
        d.qualityCheck.overdue > 0 && { path: "/fixed-asset/quality-check", text: `${fmtNum(d.qualityCheck.overdue)} quality check follow-${d.qualityCheck.overdue === 1 ? "up is" : "ups are"} past due.` },
        d.maintenance.notPosted > 0 && { path: "/fixed-asset/maintenance", text: `${fmtNum(d.maintenance.notPosted)} maintenance ${d.maintenance.notPosted === 1 ? "entry is" : "entries are"} still in draft (${fmt(d.maintenance.notPostedAmount)}).` },
      ].filter(Boolean) as { path: string; text: string }[]
    : [];

  const hasYear = !!d && d.depreciation.months.some((m) => m.amount > 0);
  const qcTotal = d ? d.qualityCheck.byStatus.reduce((s, r) => s + r.count, 0) : 0;

  return (
    <div>
      <style>{SHEET_CSS + RECENT_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Fixed Asset"]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Fixed Asset</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Fixed assets overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              What the register holds and is worth, what is waiting for codes, users or checks, and what has been spent and charged this year.
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
            Could not load the fixed asset figures{(error as Error)?.message ? ` (${(error as Error).message})` : ""}. Use Re-read to try again.
          </div>
        )}

        {/* A — figures */}
        <Detail tag="A" title="Right now" note={d ? `"This year" is the financial year, ${fy}` : "Open a figure for its page"}>
          {isLoading ? (
            <div className="grid4" style={{ gap: 16 }}>{Array.from({ length: 8 }).map((_, i) => <Skel key={i} h={58} />)}</div>
          ) : (
            <div className="grid4" style={{ rowGap: 22, columnGap: 24 }}>
              {figures.map((f) => (
                <button key={f.label} onClick={() => navigate(f.path)} style={{ textAlign: "left", minWidth: 0 }}>
                  <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>{f.label}</span>
                  <span className="figure" style={{ display: "block", fontSize: "clamp(22px, 2.4vw, 32px)", color: f.warn ? "var(--red)" : undefined }}>{f.value}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{f.sub}</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* B — what needs doing */}
        <Detail tag="B" title="Needs attention">
          {isLoading || !d ? (<><Skel h={22} /><Skel h={22} /></>) : attention.length === 0 ? empty("Nothing is waiting: every batch has codes, every asset a user, depreciation is posted and no follow-up is overdue.") : (
            <div>
              {attention.map((a) => (
                <button key={a.text} onClick={() => navigate(a.path)} className="row"
                  style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--rule-soft)", textAlign: "left" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink)", minWidth: 0 }}>
                    <i style={{ width: 8, height: 8, flexShrink: 0, background: "var(--red)" }} />
                    {a.text}
                  </span>
                  <span style={{ color: "var(--graphite)", fontSize: 13 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* C + D */}
        <div className="grid2">
          <Detail tag="C" title="Value by category" note="Largest eight by cost">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : <CostBars rows={d.byCategory} emptyText="No assets in the register yet." />}
          </Detail>
          <Detail tag="D" title="Assets by status">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /></>) : <StatusList rows={d.byStatus} total={d.register.assets} unit="assets" money />}
          </Detail>
        </div>

        {/* E */}
        <Detail tag="E" title="Twelve months of depreciation" note="Posted entries, reversals left out">
          {isLoading ? <Skel h={220} /> : !hasYear ? empty("No depreciation has been posted in the last twelve months.") : <YearPlot months={d!.depreciation.months} />}
        </Detail>

        {/* F + G */}
        <div className="grid2">
          <Detail tag="F" title="Value by project" note="Largest eight by cost">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : <CostBars rows={d.byProject} emptyText="No assets are on a project yet." />}
          </Detail>
          <Detail tag="G" title="Quality checks">
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /></>) : (
              <>
                <StatusList rows={d.qualityCheck.byStatus} total={qcTotal} unit="checks" />
                <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>
                  {fmtNum(d.transfers.thisYear)} {d.transfers.thisYear === 1 ? "transfer" : "transfers"} this year{d.transfers.lastDate ? `, the last on ${dayName(d.transfers.lastDate)}` : ""} · {fmtNum(d.inventory.codesTaggedThisYear)} codes made this year
                </p>
              </>
            )}
          </Detail>
        </div>

        {/* H — latest across the module */}
        <Detail tag="H" title="Latest activity" note="Across every fixed asset page">
          {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : d.recent.length === 0 ? empty("Nothing has been recorded yet.") : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
                <thead>
                  <tr>
                    {["When", "What", "Reference", "Detail", "By"].map((h) => (
                      <th key={h} className="label" style={{ textAlign: "left", padding: "0 10px 8px 0", borderBottom: "1px solid var(--ink)", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r, i) => (
                    <tr key={i} className="fa-recent" onClick={() => navigate(r.path)} style={{ cursor: "pointer" }}>
                      <td style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--rule-soft)", whiteSpace: "nowrap", color: "var(--graphite)" }} title={new Date(r.at).toLocaleString("en-IN")}>{whenName(r.at)}</td>
                      <td style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--rule-soft)", whiteSpace: "nowrap" }}><span className="label" style={{ color: "var(--ink)" }}>{r.kind}</span></td>
                      <td className="mono" style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--rule-soft)", whiteSpace: "nowrap" }}>{r.ref || "—"}</td>
                      <td style={{ padding: "9px 10px 9px 0", borderBottom: "1px solid var(--rule-soft)", color: "var(--ink-2)" }}>{r.detail || "—"}</td>
                      <td style={{ padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", whiteSpace: "nowrap", color: "var(--graphite)" }}>{r.who || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Detail>

        {/* I — shortcuts */}
        <Detail tag="I" title="Go to">
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
