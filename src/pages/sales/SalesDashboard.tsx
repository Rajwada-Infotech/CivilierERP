import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Skel, SheetMark } from "@/components/sheet/Sheet";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SalesDashboardData {
  saleOrders: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    draftCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
  saleInvoices: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    totalReceived: number;
    paidCount: number;
    pendingCount: number;
  };
  recentSaleOrders: RecentSaleOrder[];
  recentSaleInvoices: RecentSaleInvoice[];
}

interface RecentSaleOrder {
  SaleOrderID: number;
  DocNo: string;
  OrderDate: string;
  TotalAmount: number;
  Status: string;
  ToCompanyName: string;
}

interface RecentSaleInvoice {
  SaleInvoiceID: number;
  SaleInvoiceNo: string;
  InvoiceDate: string;
  Amount: number;
  AmountReceived: number;
  PaymentStatus: string;
  CustomerName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const n = (v: unknown) => Number(v) || 0;
const fmt = (v: unknown) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n(v));
const fmtNum = (v: unknown) => n(v).toLocaleString("en-IN");
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Every page of the module (same routes and names as the Sales sidebar).
const SHORTCUTS = [
  { label: "Sale Order", path: "/sales/sale-order" },
  { label: "Sale Invoice", path: "/sales/sale-invoice" },
  { label: "Received Payment", path: "/sales/payment" },
];

const empty = (text: string) => <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{text}</p>;

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function SalesDashboard() {
  usePageRights("sales-dashboard");
  const navigate = useNavigate();

  const { data: d, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<SalesDashboardData>({
    queryKey: ["salesDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/sales-dashboard`);
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json();
    },
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const so = d?.saleOrders;
  const si = d?.saleInvoices;

  const figures: { path: string; label: string; value: string; sub: string; warn?: boolean }[] =
    so && si
      ? [
          { path: "/sales/sale-order", label: "Sale orders today", value: fmtNum(so.todayCount), sub: `${fmtNum(so.totalCount)} orders in all` },
          { path: "/sales/sale-invoice", label: "Invoices today", value: fmtNum(si.todayCount), sub: `${fmtNum(si.totalCount)} invoices in all` },
          { path: "/sales/sale-order", label: "Total order value", value: fmt(so.totalAmount), sub: `${fmtNum(so.approvedCount)} approved · ${fmtNum(so.pendingCount)} pending` },
          { path: "/sales/payment", label: "Amount received", value: fmt(si.totalReceived), sub: `of ${fmt(si.totalAmount)} invoiced` },
          { path: "/sales/sale-order", label: "Draft orders", value: fmtNum(so.draftCount), sub: "Not yet submitted" },
          { path: "/sales/sale-order", label: "Pending approval", value: fmtNum(so.pendingCount), sub: "Awaiting approval", warn: so.pendingCount > 0 },
          { path: "/sales/sale-invoice", label: "Invoices paid", value: fmtNum(si.paidCount), sub: "Fully settled" },
          { path: "/sales/sale-invoice", label: "Invoices pending", value: fmtNum(si.pendingCount), sub: "Payment outstanding", warn: si.pendingCount > 0 },
        ]
      : [];

  const viewAll = (path: string) => (
    <button onClick={() => navigate(path)} className="label link" style={{ color: "var(--blue)" }}>
      View all →
    </button>
  );

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Sales"]} />
      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Sales</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Sales overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Sale orders, invoices and collections at a glance.
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
            Could not load the sales figures{(error as Error)?.message ? ` (${(error as Error).message})` : ""}. Use Re-read to try again.
          </div>
        )}

        {/* A — figures */}
        <Detail tag="A" title="Right now" note="Open a figure for its page">
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

        {/* B + C — recent */}
        <div className="grid2">
          <Detail tag="B" title="Recent sale orders" note={viewAll("/sales/sale-order")}>
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : d.recentSaleOrders.length === 0 ? empty("No sale orders recorded yet.") : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 380 }}>
                  <thead>
                    <tr>
                      <th>Doc no</th>
                      <th>To</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentSaleOrders.map((o) => (
                      <tr key={o.SaleOrderID} className="go" onClick={() => navigate("/sales/sale-order")}>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>{o.DocNo || "—"}</td>
                        <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.ToCompanyName || "—"}</td>
                        <td className="figure" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{o.TotalAmount != null ? fmt(o.TotalAmount) : "—"}</td>
                        <td className="mono" style={{ whiteSpace: "nowrap", color: "var(--graphite)" }}>{fmtDate(o.OrderDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Detail>

          <Detail tag="C" title="Recent sale invoices" note={viewAll("/sales/sale-invoice")}>
            {isLoading || !d ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : d.recentSaleInvoices.length === 0 ? empty("No sale invoices recorded yet.") : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 340 }}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentSaleInvoices.map((inv) => {
                      const status = inv.PaymentStatus || "Pending Payment";
                      return (
                        <tr key={inv.SaleInvoiceID} className="go" onClick={() => navigate("/sales/sale-invoice")}>
                          <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.CustomerName || "—"}</td>
                          <td className="figure" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{inv.Amount != null ? fmt(inv.Amount) : "—"}</td>
                          <td><SheetMark text={status} tone={status === "Paid" ? "done" : "waiting"} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Detail>
        </div>

        {/* D — shortcuts */}
        <Detail tag="D" title="Go to">
          <div className="grid3" style={{ gap: 0 }}>
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
