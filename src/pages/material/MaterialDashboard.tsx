import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable } from "@/components/ui/DataTable";
import { SHEET_CSS, Detail, Skel, statusTone } from "@/components/sheet/Sheet";
import {
  type DashboardData,
  normalise,
  fmt,
  fmtNum,
  share,
  GRN_COLS,
  PO_COLS,
  EXP_COLS,
  ISSUE_COLS,
  REQUEST_COLS,
} from "./dashboard/shared";
import { DrillDialog, type DrillKey } from "./dashboard/DrillDialog";
import { FortnightPlot } from "./dashboard/FortnightPlot";

type Recent = "grns" | "pos" | "expenses" | "issues" | "requests";

const RECENT: Record<Recent, { label: string; path: string; key: keyof DashboardData; cols: any; empty: string }> = {
  grns: { label: "GRNs", path: "/material/grn", key: "recentGRNs", cols: GRN_COLS, empty: "No goods receipts yet." },
  pos: { label: "Purchase orders", path: "/material/purchase-order", key: "recentPOs", cols: PO_COLS, empty: "No purchase orders yet." },
  expenses: { label: "Expenses", path: "/material/expense-booking", key: "recentExpenses", cols: EXP_COLS, empty: "No expense bookings yet." },
  issues: { label: "Issues", path: "/material/issues", key: "recentIssues", cols: ISSUE_COLS, empty: "No material issues yet." },
  requests: { label: "Requests", path: "/material/material-request", key: "recentRequests", cols: REQUEST_COLS, empty: "No material requests yet." },
};

const SHORTCUTS = [
  { label: "New GRN", path: "/material/grn" },
  { label: "Purchase order", path: "/material/purchase-order" },
  { label: "Issues", path: "/material/issues" },
  { label: "Material request", path: "/material/material-request" },
  { label: "Expense booking", path: "/material/expense-booking" },
  { label: "UOM master", path: "/material/uom" },
  { label: "Inventory", path: "/material/inventory-master" },
  { label: "T&C master", path: "/material/t-c-master" },
];

const fillFor = (status: string): React.CSSProperties => {
  const tone = statusTone(status);
  return tone === "done" ? { background: "var(--blue)" } : tone === "stopped" ? { background: "var(--red)" } : {};
};

export default function MaterialDashboard() {
  usePageRights("material-dashboard");
  const navigate = useNavigate();
  const [drill, setDrill] = useState<DrillKey | null>(null);
  const [recent, setRecent] = useState<Recent>("grns");

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ["materialDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/material-dashboard");
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      return normalise(await res.json().catch(() => ({})));
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 1,
  });

  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const d = data;
  const netStock = d ? d.stock.totalIn - d.stock.totalOut : 0;

  const figures: { key: DrillKey | null; path?: string; label: string; value: string; sub: string; red?: boolean }[] = d
    ? [
        { key: "items", label: "Items", value: fmtNum(d.items.count), sub: `${fmtNum(d.items.groupCount)} item groups` },
        { key: "grns", label: "GRNs this month", value: fmtNum(d.grns.thisMonth), sub: `${fmtNum(d.grns.today)} today · ${fmt(d.grns.thisMonthValue)}` },
        { key: "pos", label: "Open purchase orders", value: fmtNum(d.purchaseOrders.open), sub: `${fmt(d.purchaseOrders.openValue)} not yet received` },
        { key: "expenses", label: "Pending expenses", value: fmtNum(d.expenses.pending), sub: d.expenses.pending ? `${fmt(d.expenses.pendingAmount)} waiting for approval` : "nothing waiting for approval" },
        { key: "stock", label: "Net stock", value: fmtNum(netStock), sub: `${fmtNum(d.stock.uniqueItems)} items tracked · ${fmtNum(d.stock.totalIn)} in, ${fmtNum(d.stock.totalOut)} out`, red: netStock < 0 },
        { key: "issues", label: "Issues this month", value: fmtNum(d.materialIssues.thisMonth), sub: `${fmtNum(d.materialIssues.today)} today · ${fmtNum(d.materialIssues.total)} in all` },
        { key: "requests", label: "Material requests", value: fmtNum(d.materialRequests.total), sub: `${fmtNum(d.materialRequests.thisMonth)} this month · ${fmtNum(d.materialRequests.pending)} pending` },
        { key: null, path: "/material/uom", label: "Units of measure", value: fmtNum(d.uom.total), sub: "in the UOM master" },
      ]
    : [];

  const requestRows = d
    ? [
        { label: "Pending", count: d.materialRequests.pending, fill: {} as React.CSSProperties },
        { label: "Approved", count: d.materialRequests.approved, fill: { background: "var(--blue)" } },
        { label: "Ordered", count: d.materialRequests.ordered, fill: { background: "var(--blue)" } },
        { label: "Partially Ordered", count: d.materialRequests.partiallyOrdered, fill: { backgroundColor: "var(--sheet)", backgroundImage: "linear-gradient(var(--blue-mid), var(--blue-mid))" } },
        { label: "Draft", count: d.materialRequests.draft, fill: {} as React.CSSProperties },
      ]
    : [];

  const poTotal = d ? d.poStatusBreakdown.reduce((s, r) => s + r.Count, 0) : 0;
  const maxIn = d ? Math.max(1, ...d.topItems.map((i) => Number(i.TotalIn) || 0)) : 1;
  const hasTimeline = !!d && d.timeline.some((t) => t.grn > 0 || t.po > 0);
  const recentRows = (d?.[RECENT[recent].key] as any[]) ?? [];

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Material"]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Material</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Material overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              What has been ordered, received, issued and requested, what is still open, and how stock stands.
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
            Could not load the material figures{(error as Error)?.message ? ` (${(error as Error).message})` : ""}. Use Re-read to try again.
          </div>
        )}

        {/* A — figures, each opens the records behind it */}
        <Detail tag="A" title="Right now" note="Open a figure for its records">
          {isLoading ? (
            <div className="grid4" style={{ gap: 16 }}>{Array.from({ length: 8 }).map((_, i) => <Skel key={i} h={58} />)}</div>
          ) : (
            <div className="grid4" style={{ rowGap: 22, columnGap: 24 }}>
              {figures.map((f) => (
                <button key={f.label} onClick={() => (f.key ? setDrill(f.key) : navigate(f.path!))} style={{ textAlign: "left", minWidth: 0 }}>
                  <span className="label link" style={{ display: "inline-block", marginBottom: 8, color: f.red ? "var(--red)" : undefined }}>{f.label}</span>
                  <span className="figure" style={{ display: "block", fontSize: "clamp(22px, 2.4vw, 32px)", color: f.red ? "var(--red)" : undefined }}>{f.value}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{f.sub}</span>
                </button>
              ))}
            </div>
          )}
        </Detail>

        {/* B + C */}
        <div className="grid2">
          <Detail tag="B" title="Ordered against received">
            {isLoading || !d ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Ordered (PO)</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(26px, 3.2vw, 42px)" }}>{fmt(d.purchaseOrders.totalValue)}</span>
                  </div>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Received (GRN)</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(26px, 3.2vw, 42px)", color: "var(--ink-2)" }}>{fmt(d.grns.totalValue)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 20 }}>
                  <span className="hatch" style={{ display: "block", height: 26, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img"
                    aria-label={`Received ${Math.round(share(d.grns.totalValue, d.purchaseOrders.totalValue))}% of the value ordered`}>
                    <span className="grow" style={{ display: "block", height: "100%", width: `${share(d.grns.totalValue, d.purchaseOrders.totalValue)}%`, background: "var(--blue)" }} />
                  </span>
                  <span style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>
                    {Math.round(share(d.grns.totalValue, d.purchaseOrders.totalValue))}% of the value ordered has been received · {fmtNum(d.purchaseOrders.total)} orders, {fmtNum(d.grns.total)} receipts
                  </span>
                </div>
                <div style={{ marginTop: 16 }}>
                  {[
                    { label: "Still open", sub: `${fmtNum(d.purchaseOrders.open)} orders not yet fully received`, value: fmt(d.purchaseOrders.openValue), go: "pos" as DrillKey },
                    { label: "Expenses booked", sub: `${fmtNum(d.expenses.approved)} approved · ${fmtNum(d.expenses.pending)} pending`, value: fmt(d.expenses.totalAmount), go: "expenses" as DrillKey },
                  ].map((s) => (
                    <button key={s.label} onClick={() => setDrill(s.go)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "12px 0", borderTop: "1px solid var(--rule-soft)", width: "100%" }}>
                      <span style={{ minWidth: 0, textAlign: "left" }}>
                        <span className="label link" style={{ color: "var(--ink)" }}>{s.label}</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                      </span>
                      <span className="figure" style={{ fontSize: 22, whiteSpace: "nowrap" }}>{s.value}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Detail>

          <Detail tag="C" title="Material requests" note={d ? `${fmtNum(d.materialRequests.total)} in all` : undefined}>
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : d.materialRequests.total === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No material requests yet.</p>
            ) : (
              <div>
                {requestRows.map((r) => (
                  <button key={r.label} onClick={() => navigate(`/material/material-request?status=${encodeURIComponent(r.label)}`)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", opacity: r.count ? 1 : 0.5 }}>
                    <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span className="label link" style={{ color: "var(--ink)" }}>{r.label}</span>
                      <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
                        <span className="figure" style={{ fontSize: 15, marginRight: 8 }}>{fmtNum(r.count)}</span>
                        {Math.round(share(r.count, d.materialRequests.total))}%
                      </span>
                    </span>
                    <span className="hatch" style={{ display: "block", height: 7, marginTop: 7, border: "1px solid var(--ink)" }}>
                      <span style={{ display: "block", height: "100%", width: `${share(r.count, d.materialRequests.total)}%`, ...r.fill }} />
                    </span>
                  </button>
                ))}
                <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>{fmtNum(d.materialRequests.thisMonth)} raised this month</p>
              </div>
            )}
          </Detail>
        </div>

        {/* D */}
        <Detail tag="D" title="Fourteen days" note="Value ordered and received each day">
          {isLoading ? <Skel h={220} /> : !hasTimeline ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>Nothing was ordered or received in the last fourteen days.</p>
          ) : <FortnightPlot rows={d!.timeline} />}
        </Detail>

        {/* E + F */}
        <div className="grid2">
          <Detail tag="E" title="Purchase orders by status" note={d ? `${fmtNum(poTotal)} orders` : undefined}>
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /></>) : d.poStatusBreakdown.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No purchase orders yet.</p>
            ) : (
              <div>
                {d.poStatusBreakdown.map((r) => (
                  <div key={r.Status} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                    <i className={statusTone(r.Status || "Draft") === "waiting" ? "hatch" : ""} style={{ width: 10, height: 10, flexShrink: 0, border: "1px solid var(--ink)", ...fillFor(r.Status || "Draft") }} />
                    <span className="label" style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}>{r.Status || "Draft"}</span>
                    <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>{fmtNum(r.Count)} · {Math.round(share(r.Count, poTotal))}%</span>
                    <span className="figure" style={{ fontSize: 15, minWidth: 110, textAlign: "right" }}>{fmt(Number(r.TotalValue))}</span>
                  </div>
                ))}
              </div>
            )}
          </Detail>

          <Detail tag="F" title="Most received items" note="By quantity in">
            {isLoading || !d ? (<><Skel h={24} /><Skel h={24} /><Skel h={24} /></>) : d.topItems.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No stock movements yet.</p>
            ) : (
              <div>
                {d.topItems.map((item, idx) => {
                  const inQty = Number(item.TotalIn) || 0;
                  const outQty = Number(item.TotalOut) || 0;
                  return (
                    <div key={item.ItemID || idx} style={{ padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <span className="label" style={{ width: 16 }}>{idx + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.ItemName || "Unnamed item"}</span>
                        <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>
                          {fmtNum(inQty)} in · {fmtNum(outQty)} out
                        </span>
                      </span>
                      {/* in measured against the busiest item; the issued share of it drawn over in ink */}
                      <span className="hatch" style={{ display: "block", height: 7, marginTop: 6, marginLeft: 26, border: "1px solid var(--ink)", width: `calc(${share(inQty, maxIn)}% - 26px)`, minWidth: 6 }}>
                        <span style={{ display: "block", height: "100%", width: `${share(outQty, inQty)}%`, background: "var(--blue)" }} />
                      </span>
                    </div>
                  );
                })}
                <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--graphite)" }}>Bar length is quantity received; the solid part has been issued out.</p>
              </div>
            )}
          </Detail>
        </div>

        {/* G — latest documents */}
        <section className="cell">
          <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span className="tag">G</span>
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

        {/* H — shortcuts */}
        <Detail tag="H" title="Go to">
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

      <DrillDialog open={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
