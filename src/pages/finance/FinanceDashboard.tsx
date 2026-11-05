import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SHEET_CSS, Detail, Dimension, Skel } from "@/components/sheet/Sheet";

// Finance Dashboard, on the same drawing sheet as Home and CRM (components/sheet/Sheet).
//
// The one idea of the page is the cash line: money received is drawn solid above it, money paid out is drawn hatched
// below it - in the totals (detail A) and day by day (detail C). Red is kept for a net outflow.

// ─── Types ────────────────────────────────────────────────────────────────────
interface FinanceDashboardData {
  paymentsMade: { totalCount: number; todayCount: number; totalAmount: number; todayAmount: number };
  receivedPayments: { totalCount: number; todayCount: number; totalAmount: number; todayAmount: number; approvedCount: number; draftCount: number };
  cheques: { totalCount: number; activeCount: number; inactiveCount: number };
  cards: { totalCount: number; activeCount: number; inactiveCount: number };
  banks: { totalCount: number; activeCount: number };
  recentPaymentsMade: RecentPaymentMade[];
  recentPaymentsReceived: RecentPaymentReceived[];
  timeline: { date: string; made: number; received: number }[];
}

interface RecentPaymentMade {
  PPaymentID: number;
  PPaymentName: string;
  PMode: string;
  PAmount: number;
  PDate: string;
  PBankName: string;
  PDocType: string;
  PProject: string;
  PCreatedAt: string;
}

interface RecentPaymentReceived {
  RPPaymentID: number;
  RPReceivedFrom: string;
  RPMode: string;
  RPAmount: number;
  RPDocDate: string;
  RPBankName: string;
  RPStatus: string;
  RPCreatedAt: string;
}

interface MonthlyIncomePoint {
  key: string;
  month: string;
  year: number;
  income: number;
  trend: "growth" | "degrowth" | "neutral";
}

const EMPTY_DATA: FinanceDashboardData = {
  paymentsMade: { totalCount: 0, todayCount: 0, totalAmount: 0, todayAmount: 0 },
  receivedPayments: { totalCount: 0, todayCount: 0, totalAmount: 0, todayAmount: 0, approvedCount: 0, draftCount: 0 },
  cheques: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  cards: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  banks: { totalCount: 0, activeCount: 0 },
  recentPaymentsMade: [],
  recentPaymentsReceived: [],
  timeline: [],
};

/** Normalise whatever shape the backend returns into the new shape. */
function normalise(raw: any): FinanceDashboardData {
  if (!raw || typeof raw !== "object") return EMPTY_DATA;
  // Support old backend shape (payments / purchaseOrders / grns …)
  const paymentsMade = raw.paymentsMade ?? {
    totalCount: raw.payments?.totalCount ?? 0,
    todayCount: raw.payments?.todayCount ?? 0,
    totalAmount: raw.payments?.totalAmount ?? 0,
    todayAmount: raw.payments?.todayAmount ?? 0,
  };
  return {
    paymentsMade,
    receivedPayments: raw.receivedPayments ?? EMPTY_DATA.receivedPayments,
    cheques: raw.cheques ?? EMPTY_DATA.cheques,
    cards: raw.cards ?? EMPTY_DATA.cards,
    banks: raw.banks ?? EMPTY_DATA.banks,
    recentPaymentsMade: raw.recentPaymentsMade ?? raw.recentPayments ?? [],
    recentPaymentsReceived: raw.recentPaymentsReceived ?? [],
    timeline: raw.timeline ?? [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const n0 = (v: unknown) => Number(v) || 0;
const fmtInt = (v: unknown) => n0(v).toLocaleString("en-IN");
const split = (v: unknown) => {
  const n = Math.abs(n0(v));
  if (n >= 1_00_00_000) return { num: (n / 1_00_00_000).toFixed(2), unit: "Cr" };
  if (n >= 1_00_000) return { num: (n / 1_00_000).toFixed(1), unit: "L" };
  if (n >= 1_000) return { num: (n / 1_000).toFixed(0), unit: "K" };
  return { num: n.toFixed(0), unit: "" };
};
const money = (v: unknown) => {
  const m = split(v);
  return `${n0(v) < 0 ? "−" : ""}₹${m.num}${m.unit ? ` ${m.unit}` : ""}`;
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

const Figure: React.FC<{ value: unknown; size?: string; color?: string }> = ({ value, size = "clamp(36px, 4.6vw, 62px)", color }) => {
  const m = split(value);
  return (
    <span className="figure" style={{ fontSize: size, color }}>
      <span style={{ fontSize: "0.5em", fontWeight: 500, marginRight: 3, opacity: 0.8 }}>₹</span>
      {m.num}
      {m.unit && <span style={{ fontSize: "0.36em", fontWeight: 500, marginLeft: 5, letterSpacing: 0 }}>{m.unit}</span>}
    </span>
  );
};

// ── C: fourteen days about the cash line — received above it, paid below ────
const CashLinePlot: React.FC<{ rows: { date: string; made: number; received: number }[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 250, pad = 8, top = 16, bottom = 208, mid = (top + bottom) / 2;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => Math.max(n0(r.made), n0(r.received))));
  const half = mid - top;
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(26, slot * 0.56);
  const net = rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${(mid - ((n0(r.received) - n0(r.made)) / max) * half).toFixed(1)}`).join(" ");
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Received</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i className="hatch" style={{ width: 10, height: 10, border: "1px solid var(--ink)", display: "inline-block" }} /> Paid out</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 2, background: "var(--ink)", display: "inline-block" }} /> Net for the day</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active
            ? `${fmtDate(active.date)} · ${money(active.received)} in · ${money(active.made)} out · net ${money(n0(active.received) - n0(active.made))}`
            : "Hover a day for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Money received and paid out each day, last fourteen days" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="fin-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1" opacity="0.55" />
          </pattern>
        </defs>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <line x1={pad} x2={W - pad} y1={bottom} y2={bottom} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 5} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{money(max)} in</text>
        <text x={pad + 2} y={bottom + 12} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{money(max)} out</text>
        {rows.map((r, i) => {
          const up = (n0(r.received) / max) * half;
          const down = (n0(r.made) / max) * half;
          const d = new Date(r.date);
          return (
            <g key={r.date || i} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              <rect x={cx(i) - w / 2} y={mid - up} width={w} height={up} fill="var(--blue)" fillOpacity={hover == null || hover === i ? 0.92 : 0.4} />
              <rect x={cx(i) - w / 2} y={mid} width={w} height={down} fill="url(#fin-hatch)" stroke="var(--ink)" strokeWidth="1" opacity={hover == null || hover === i ? 1 : 0.45} />
              <text x={cx(i)} y={H - 14} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{d.getDate()}</text>
              {(i === 0 || d.getDate() === 1) && (
                <text x={cx(i)} y={H - 2} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="8" letterSpacing="1" fill="var(--faint)">
                  {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
        {/* the cash line itself */}
        <line x1={pad} x2={W - pad} y1={mid} y2={mid} stroke="var(--ink)" strokeWidth="1.5" />
        {rows.length > 1 && <path className="draw" d={net} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeDasharray="1 0" strokeLinejoin="round" pointerEvents="none" opacity="0.85" />}
        {rows.map((r, i) => (
          <circle key={i} cx={cx(i)} cy={mid - ((n0(r.received) - n0(r.made)) / max) * half} r={hover === i ? 4 : 2.6} fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.4" pointerEvents="none" />
        ))}
      </svg>
    </div>
  );
};

// ── E: income by month; a fall from the month before is drawn in red ────────
const IncomePlot: React.FC<{ rows: MonthlyIncomePoint[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 210, pad = 8, top = 24, base = 170;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => Math.abs(n0(r.income))));
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(40, slot * 0.56);
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Up on the month before</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--red)", display: "inline-block" }} /> Down</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${active.month} ${active.year} · ${money(active.income)}` : "Hover a month for its figure"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Income by month" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" />
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{money(max)}</text>
        {rows.map((r, i) => {
          const h = (Math.abs(n0(r.income)) / max) * (base - top);
          const fill = r.trend === "degrowth" ? "var(--red)" : r.trend === "growth" ? "var(--blue)" : "var(--blue-mid)";
          return (
            <g key={r.key || i} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              <rect x={cx(i) - w / 2} y={base - h} width={w} height={h} fill={fill} fillOpacity={hover == null || hover === i ? 0.92 : 0.4} />
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" letterSpacing="1" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{String(r.month).slice(0, 3).toUpperCase()}</text>
              <text x={cx(i)} y={base + 30} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="8" fill="var(--faint)">{String(r.year).slice(-2)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** One instrument: a bar measured out of its total, in use solid and the rest hatched. */
const Measure: React.FC<{ name: string; live: number; total: number; liveWord: string; restWord: string; onOpen: () => void }> = ({ name, live, total, liveWord, restWord, onOpen }) => (
  <button onClick={onOpen} style={{ display: "block", width: "100%", padding: "11px 0", borderBottom: "1px solid var(--rule-soft)" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
      <span className="label link" style={{ color: "var(--ink)" }}>{name}</span>
      <span>
        <span className="figure" style={{ fontSize: 22 }}>{fmtInt(live)}</span>
        <span style={{ fontSize: 12, color: "var(--graphite)", marginLeft: 6 }}>of {fmtInt(total)}</span>
      </span>
    </div>
    <div className="hatch" style={{ height: 9, marginTop: 8, border: "1px solid var(--ink)" }}>
      <div className="grow" style={{ height: "100%", width: `${share(live, total)}%`, background: "var(--blue)" }} />
    </div>
    <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>
      {fmtInt(live)} {liveWord} · {fmtInt(Math.max(0, total - live))} {restWord}
    </div>
  </button>
);

// ─── Page ─────────────────────────────────────────────────────────────────────
const FinanceDashboard = () => {
  usePageRights("finance-dashboard");
  const navigate = useNavigate();

  const { data: rawData, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<FinanceDashboardData>({
    queryKey: ["financeDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/finance-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json().catch(() => ({}));
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });
  const data = rawData ? normalise(rawData) : EMPTY_DATA;

  const { data: monthlyIncome, isLoading: monthlyIncomeLoading } = useQuery<MonthlyIncomePoint[]>({
    queryKey: ["financeMonthlyIncome"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/financial-statements/monthly-income");
      if (!res.ok) throw new Error("Failed to fetch monthly income");
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json?.months) ? json.months : [];
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });
  const income = monthlyIncome ?? [];

  const received = n0(data.receivedPayments.totalAmount);
  const paid = n0(data.paymentsMade.totalAmount);
  const net = received - paid;
  const receivedPct = share(received, received + paid);
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const todayNet = n0(data.receivedPayments.todayAmount) - n0(data.paymentsMade.todayAmount);

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Finance"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Finance</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Finance overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              What has been received and paid, how the last fortnight ran, and the cheques, cards and banks behind it.
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

        {isError && <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not load the finance figures. Use Re-read to try again.</div>}

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Received against paid" note="All time">
            {isLoading ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <button onClick={() => navigate("/received-payments")}>
                    <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>Received</span>
                    <span style={{ display: "block" }}><Figure value={received} /></span>
                  </button>
                  <button onClick={() => navigate("/payments")}>
                    <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>Paid out</span>
                    <span style={{ display: "block" }}><Figure value={paid} color="var(--ink-2)" /></span>
                  </button>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>{net >= 0 ? "Net inflow" : "Net outflow"}</span>
                    <Figure value={net} size="clamp(24px, 2.8vw, 36px)" color={net < 0 ? "var(--red)" : "var(--blue)"} />
                  </div>
                </div>

                <div style={{ marginTop: 22 }}>
                  <div style={{ display: "flex", height: 30, border: "1.5px solid var(--ink)", background: "var(--sheet)" }} role="img"
                    aria-label={`Received is ${Math.round(receivedPct)} percent of all money moved`}>
                    <div className="grow" style={{ width: `${receivedPct}%`, background: "var(--blue)" }} />
                    <div className="hatch" style={{ flex: 1, borderLeft: received + paid > 0 ? "1.5px solid var(--ink)" : 0 }} />
                  </div>
                  <div style={{ display: "flex" }}>
                    <div style={{ width: `${Math.min(Math.max(receivedPct, 24), 76)}%`, minWidth: 0 }}>
                      <Dimension from={0} to={100} text={`${fmtInt(data.receivedPayments.totalCount)} receipts`} color="var(--blue)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <Dimension from={0} to={100} text={`${fmtInt(data.paymentsMade.totalCount)} payments`} />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", marginTop: 18, fontSize: 11.5, color: "var(--ink-2)" }}>
                  <span><i style={{ display: "inline-block", width: 10, height: 10, background: "var(--blue)", marginRight: 6 }} />Received</span>
                  <span><i className="hatch" style={{ display: "inline-block", width: 10, height: 10, border: "1px solid var(--ink)", marginRight: 6 }} />Paid out</span>
                  <span>{fmtInt(data.receivedPayments.approvedCount)} receipts approved · {fmtInt(data.receivedPayments.draftCount)} in draft</span>
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="Today">
            {isLoading ? (<><Skel h={40} /><Skel h={40} /><Skel h={40} /></>) : (
              <div>
                {[
                  { label: "Received today", value: money(data.receivedPayments.todayAmount), sub: `${fmtInt(data.receivedPayments.todayCount)} receipt${n0(data.receivedPayments.todayCount) === 1 ? "" : "s"}`, path: "/received-payments", color: undefined as string | undefined },
                  { label: "Paid out today", value: money(data.paymentsMade.todayAmount), sub: `${fmtInt(data.paymentsMade.todayCount)} payment${n0(data.paymentsMade.todayCount) === 1 ? "" : "s"}`, path: "/payments", color: undefined },
                  { label: "Net for today", value: money(todayNet), sub: todayNet < 0 ? "more went out than came in" : "in hand after today's payments", path: "/reports", color: todayNet < 0 ? "var(--red)" : undefined },
                ].map((s, i) => (
                  <button key={s.label} onClick={() => navigate(s.path)} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: i ? "1px solid var(--rule-soft)" : 0, width: "100%" }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label link" style={{ color: "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap", color: s.color }}>{s.value}</span>
                  </button>
                ))}
              </div>
            )}
          </Detail>
        </div>

        {/* C + D */}
        <div className="grid2">
          <Detail tag="C" title="Fourteen days about the cash line" note="In above, out below">
            {isLoading ? <Skel h={240} /> : data.timeline.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No payments in the last fourteen days.</p>
            ) : <CashLinePlot rows={data.timeline} />}
          </Detail>

          <Detail tag="D" title="Instruments" note="In use against held">
            {isLoading ? (<><Skel h={44} /><Skel h={44} /><Skel h={44} /></>) : (
              <>
                <Measure name="Bank accounts" live={n0(data.banks.activeCount)} total={n0(data.banks.totalCount)} liveWord="active" restWord="inactive" onOpen={() => navigate("/masters/banks")} />
                <Measure name="Cheque lots" live={n0(data.cheques.activeCount)} total={n0(data.cheques.totalCount)} liveWord="active" restWord="inactive" onOpen={() => navigate("/masters/cheque")} />
                <Measure name="Cards" live={n0(data.cards.activeCount)} total={n0(data.cards.totalCount)} liveWord="active" restWord="inactive" onOpen={() => navigate("/masters/card")} />
              </>
            )}
          </Detail>
        </div>

        {/* E */}
        <Detail tag="E" title="Income by month" note="From the trial balance">
          {monthlyIncomeLoading ? <Skel h={200} /> : !income.some((m) => Math.abs(n0(m.income)) > 0.005) ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No income is posted for these months yet.</p>
          ) : <IncomePlot rows={income} />}
        </Detail>

        {/* F + G */}
        <div className="grid2">
          <Detail tag="F" title="Latest payments made" note={`${fmtInt(data.paymentsMade.totalCount)} in all`}>
            {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : data.recentPaymentsMade.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No payments recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 460 }}>
                  <thead><tr><th>Paid to</th><th>Mode</th><th>Date</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {data.recentPaymentsMade.slice(0, 7).map((p) => (
                      <tr key={p.PPaymentID} className="go" onClick={() => navigate("/payments")}>
                        <td style={{ maxWidth: 240 }}>
                          <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.PPaymentName || "—"}</span>
                          {(p.PProject || p.PBankName) && <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[p.PProject, p.PBankName].filter(Boolean).join(" · ")}</span>}
                        </td>
                        <td className="label">{p.PMode || "—"}</td>
                        <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{fmtDate(p.PDate)}</td>
                        <td className="num figure" style={{ fontSize: 13 }}>{money(p.PAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={() => navigate("/payments")} className="label link" style={{ marginTop: 14, display: "inline-block" }}>All payments</button>
          </Detail>

          <Detail tag="G" title="Latest receipts" note={`${fmtInt(data.receivedPayments.totalCount)} in all`}>
            {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : data.recentPaymentsReceived.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No receipts recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 420 }}>
                  <thead><tr><th>Received from</th><th>Status</th><th>Date</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {data.recentPaymentsReceived.slice(0, 7).map((p) => (
                      <tr key={p.RPPaymentID} className="go" onClick={() => navigate("/received-payments")}>
                        <td style={{ maxWidth: 220 }}>
                          <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.RPReceivedFrom || "—"}</span>
                          {(p.RPMode || p.RPBankName) && <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[p.RPMode, p.RPBankName].filter(Boolean).join(" · ")}</span>}
                        </td>
                        <td className="label" style={{ color: /reject|bounce|cancel/i.test(p.RPStatus || "") ? "var(--red)" : undefined }}>{p.RPStatus || "—"}</td>
                        <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{fmtDate(p.RPDocDate)}</td>
                        <td className="num figure" style={{ fontSize: 13 }}>{money(p.RPAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={() => navigate("/received-payments")} className="label link" style={{ marginTop: 14, display: "inline-block" }}>All receipts</button>
          </Detail>
        </div>

        {/* H */}
        <Detail tag="H" title="Go to">
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {[
              { label: "New payment", path: "/payments" },
              { label: "New receipt", path: "/received-payments" },
              { label: "Cheques", path: "/masters/cheque" },
              { label: "Cards", path: "/masters/card" },
              { label: "Banks", path: "/masters/banks" },
            ].map((q) => (
              <button key={q.label} onClick={() => navigate(q.path)} style={{ padding: "9px 16px" }}>{q.label}</button>
            ))}
          </div>
        </Detail>
      </div>
    </div>
  );
};

export default FinanceDashboard;
