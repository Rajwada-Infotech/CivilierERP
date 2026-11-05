import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getLoanSanctions, type LoanType } from "@/api/loanSanctionApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getCompanyOptions, type CompanyOption } from "@/api/bankMasterApi";
import { CompanyFilterCombo } from "@/components/CompanyFilterCombo";
import { SHEET_CSS, Detail, Skel, SheetMark } from "@/components/sheet/Sheet";

const fmt = (n: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const short = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

type Fill = "solid" | "mid" | "hatch";

// How each loan type is drawn in ink: bank borrowing solid, inter-company a
// lighter tone, money lent to customers hatched.
const LOAN_TYPES: { type: LoanType; fill: Fill }[] = [
  { type: "Bank Loan", fill: "solid" },
  { type: "Inter-Company", fill: "mid" },
  { type: "Customer Loan", fill: "hatch" },
];

const fillStyle = (fill: Fill): React.CSSProperties =>
  fill === "solid" ? { background: "var(--blue)" } : fill === "mid" ? { backgroundColor: "var(--sheet)", backgroundImage: "linear-gradient(var(--blue-mid), var(--blue-mid))" } : {};

interface UpcomingEmi {
  EMIId: number;
  LoanId: number;
  InstallmentNo: number;
  DueDate: string;
  EMIAmount: number;
  LoanNo: string;
  BorrowerName: string;
}

interface MonthlyPoint {
  month: string;
  year: string;
  sanctioned: number;
  count: number;
}

// ── C: six months — the amount sanctioned in each ────────────────────────
const SixMonthPlot: React.FC<{ rows: MonthlyPoint[] }> = ({ rows }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 230, pad = 8, top = 24, base = 188;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => r.sanctioned));
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(46, slot * 0.42);
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Sanctioned</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${active.month} ${active.year} · ${fmt(active.sanctioned)} · ${fmtNum(active.count)} loan${active.count === 1 ? "" : "s"}` : "Hover a month for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Amount sanctioned each month, last six months" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{short(max)}</text>
        {rows.map((r, i) => {
          const h = (r.sanctioned / max) * (base - top);
          const on = hover == null || hover === i;
          return (
            <g key={`${r.month}-${r.year}`} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              {r.sanctioned > 0 ? (
                <>
                  <rect x={cx(i) - w / 2} y={base - h} width={w} height={h} fill="var(--blue)" fillOpacity={on ? 0.92 : 0.4} />
                  <text x={cx(i)} y={base - h - 6} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" fill={on ? "var(--ink)" : "var(--faint)"}>{short(r.sanctioned)}</text>
                </>
              ) : (
                <text x={cx(i)} y={base - 6} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--faint)">—</text>
              )}
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" letterSpacing="1" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{r.month.toUpperCase()}</text>
              {(i === 0 || r.month === "Jan") && (
                <text x={cx(i)} y={base + 30} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="8" letterSpacing="1" fill="var(--faint)">{r.year}</text>
              )}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
    </div>
  );
};

export default function LoanDashboard() {
  const navigate = useNavigate();
  usePageRights("loan-sanction");
  // null = "All companies" — the dashboard's default view across every
  // company's loans, not a gate the user has to clear first.
  const [companyId, setCompanyId] = useState<number | null>(null);

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["company-options-loan-dashboard"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60_000,
  });

  const { data: loans = [], isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["loan-sanctions", companyId],
    queryFn: () => getLoanSanctions(companyId),
    staleTime: 30_000,
  });

  const { data: upcomingEmis = [] } = useQuery({
    queryKey: ["loan-emi-reminders", companyId],
    queryFn: () =>
      fetchWithAuth(`/api/loan-sanction/emi-reminders${companyId ? `?companyId=${companyId}` : ""}`).then((r) =>
        r.ok ? (r.json() as Promise<UpcomingEmi[]>) : [],
      ),
    staleTime: 30_000,
  });

  const totalSanctioned = loans.reduce((s, l) => s + Number(l.Amount || 0), 0);
  const activeLoans = loans.filter((l) => l.Status !== "Closed");
  const closedLoans = loans.filter((l) => l.Status === "Closed");
  // Real scheduled/paid amounts, not a linear "installments paid / total
  // installments" ratio — that approximation is wrong for amortized loans
  // (interest is front-loaded under Compound Interest, so early EMIs pay
  // down far less principal than later ones) and for any lump-sum payment,
  // which settles real money without moving PaidEMIs at all. Falls back to
  // the loan's own Amount when there's no EMI schedule (a simple transfer).
  const outstanding = loans.reduce((s, l) => {
    const scheduled = Number(l.TotalScheduledAmount || 0) || Number(l.Amount || 0);
    const paid = Number(l.TotalPaidAmount || 0);
    return s + Math.max(0, scheduled - paid);
  }, 0);
  const emiDue = upcomingEmis.reduce((s, e) => s + Number(e.EMIAmount || 0), 0);

  const recentLoans = [...loans]
    .sort((a, b) => new Date(b.CreatedAt ?? 0).getTime() - new Date(a.CreatedAt ?? 0).getTime())
    .slice(0, 5);

  const byType = LOAN_TYPES.map((t) => {
    const of = loans.filter((l) => l.LoanType === t.type);
    return { ...t, count: of.length, amount: of.reduce((s, l) => s + Number(l.Amount || 0), 0) };
  });
  const segments = byType.filter((t) => t.amount > 0);

  // Last 6 calendar months, oldest first — sums Amount for loans sanctioned
  // (CreatedAt) within each month, from whatever's already loaded above.
  const monthly: MonthlyPoint[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return d;
  }).map((monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const inMonth = loans.filter((l) => {
      if (!l.CreatedAt) return false;
      const c = new Date(l.CreatedAt);
      return c >= monthStart && c < monthEnd;
    });
    return {
      month: monthStart.toLocaleDateString("en-IN", { month: "short" }),
      year: String(monthStart.getFullYear()),
      sanctioned: inMonth.reduce((s, l) => s + Number(l.Amount || 0), 0),
      count: inMonth.length,
    };
  });
  const hasMonthly = monthly.some((m) => m.sanctioned > 0);
  const repaidPct = share(totalSanctioned - outstanding, totalSanctioned);
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Dashboard", "Loan"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Loan</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Loan overview</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              What has been sanctioned across inter-company, bank and customer loans, what is still owed, and the instalments falling due.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 5 }}>Company</span>
              <CompanyFilterCombo companies={companies} value={companyId} onChange={setCompanyId} />
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={() => refetch()} disabled={isFetching} className="label link" style={{ color: "var(--blue)" }}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {isError && <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not load the loans. Use Re-read to try again.</div>}

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Sanctioned, by loan type" note={`${fmtNum(loans.length)} loan${loans.length === 1 ? "" : "s"}`}>
            {isLoading ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : loans.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>
                No loans are sanctioned yet. Sanction one from Loan Sanction.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <button onClick={() => navigate("/loan/sanction")}>
                    <span className="label link" style={{ display: "inline-block", marginBottom: 8 }}>Sanctioned</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(28px, 3.6vw, 48px)" }}>{fmt(totalSanctioned)}</span>
                  </button>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Still owed</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(28px, 3.6vw, 48px)", color: "var(--ink-2)" }}>{fmt(outstanding)}</span>
                  </div>
                </div>

                {/* every rupee sanctioned, measured out by loan type */}
                <div style={{ marginTop: 22 }}>
                  <div className="hatch" style={{ display: "flex", height: 30, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img"
                    aria-label={segments.map((s) => `${s.type} ${fmt(s.amount)}`).join(", ")}>
                    {segments.map((s, i) => (
                      <div
                        key={s.type}
                        className={s.fill === "hatch" ? "" : "grow"}
                        title={`${s.type}: ${fmt(s.amount)}`}
                        style={{ width: `${share(s.amount, totalSanctioned)}%`, borderLeft: i ? "1.5px solid var(--ink)" : 0, ...fillStyle(s.fill) }}
                      />
                    ))}
                  </div>
                </div>

                {/* the same, as a schedule */}
                <div style={{ marginTop: 16 }}>
                  {byType.map((s) => (
                    <div key={s.type} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", opacity: s.count ? 1 : 0.5 }}>
                      <i className={s.fill === "hatch" ? "hatch" : ""} style={{ width: 10, height: 10, flexShrink: 0, border: "1px solid var(--ink)", ...fillStyle(s.fill) }} />
                      <span className="label" style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}>{s.type}</span>
                      <span style={{ fontSize: 12, color: "var(--graphite)", whiteSpace: "nowrap" }}>{fmtNum(s.count)} loan{s.count === 1 ? "" : "s"}</span>
                      <span className="figure" style={{ fontSize: 15, minWidth: 110, textAlign: "right" }}>{fmt(s.amount)}</span>
                      <span style={{ fontSize: 11.5, color: "var(--graphite)", width: 38, textAlign: "right" }}>{Math.round(share(s.amount, totalSanctioned))}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="Standing">
            {isLoading ? (<><Skel h={40} /><Skel h={40} /><Skel h={40} /></>) : (
              <div>
                <div style={{ paddingBottom: 14 }}>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label" style={{ color: "var(--ink)" }}>Repaid</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>of everything sanctioned</span>
                    </span>
                    <span className="figure" style={{ fontSize: 34, whiteSpace: "nowrap" }}>
                      {Math.round(repaidPct)}<span style={{ fontSize: "0.5em", fontWeight: 500, marginLeft: 3 }}>%</span>
                    </span>
                  </span>
                  <span className="hatch" style={{ display: "block", height: 9, marginTop: 10, border: "1px solid var(--ink)" }}>
                    <span className="grow" style={{ display: "block", height: "100%", width: `${repaidPct}%`, background: "var(--blue)" }} />
                  </span>
                  <span style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--graphite)" }}>
                    {fmt(Math.max(0, totalSanctioned - outstanding))} repaid · {fmt(outstanding)} owed
                  </span>
                </div>
                {[
                  { label: "Active loans", value: fmtNum(activeLoans.length), sub: `${fmtNum(closedLoans.length)} closed`, red: false },
                  {
                    label: "EMIs due soon",
                    value: fmtNum(upcomingEmis.length),
                    sub: upcomingEmis.length ? `${fmt(emiDue)} falls due within seven days` : "nothing falls due within seven days",
                    red: upcomingEmis.length > 0,
                  },
                ].map((s) => (
                  <button key={s.label} onClick={() => navigate("/loan/sanction")} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: "1px solid var(--rule-soft)", width: "100%" }}>
                    <span style={{ minWidth: 0, textAlign: "left" }}>
                      <span className="label link" style={{ color: s.red ? "var(--red)" : "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap", color: s.red ? "var(--red)" : undefined }}>{s.value}</span>
                  </button>
                ))}
              </div>
            )}
          </Detail>
        </div>

        {/* C */}
        <Detail tag="C" title="Six months of sanctions" note="Amount sanctioned each month">
          {isLoading ? <Skel h={220} /> : !hasMonthly ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No loans were sanctioned in the last six months.</p>
          ) : <SixMonthPlot rows={monthly} />}
        </Detail>

        {/* D */}
        <Detail tag="D" title="Latest loans" note={`${fmtNum(loans.length)} in all`}>
          {isLoading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : recentLoans.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No loans are sanctioned yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 680 }}>
                <thead><tr><th>Loan</th><th>Lender → borrower</th><th>EMIs paid</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recentLoans.map((l) => {
                    const borrower = l.BorrowerCompanyName || l.BorrowerCustomerName || "—";
                    const total = l.TotalEMIs ?? 0;
                    const paid = l.PaidEMIs ?? 0;
                    const closed = l.Status === "Closed";
                    return (
                      <tr key={l.LoanId} className="go" onClick={() => navigate(`/loan/sanction?view=${l.LoanId}`)}>
                        <td>
                          <span className="mono" style={{ display: "block", fontWeight: 600 }}>{l.LoanNo}</span>
                          <span className="label" style={{ display: "block", marginTop: 3 }}>{l.LoanType}</span>
                        </td>
                        <td style={{ color: "var(--ink-2)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.LenderCompanyName} <span style={{ color: "var(--faint)" }}>→</span> {borrower}
                        </td>
                        <td style={{ width: 130 }}>
                          {total > 0 ? (
                            <>
                              <span className="hatch" style={{ display: "block", height: 7, border: "1px solid var(--ink)" }}>
                                <span style={{ display: "block", height: "100%", width: `${share(paid, total)}%`, background: "var(--blue)" }} />
                              </span>
                              <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 4 }}>{paid} of {total}</span>
                            </>
                          ) : <span style={{ color: "var(--faint)" }}>No schedule</span>}
                        </td>
                        <td className="num"><span className="figure" style={{ fontSize: 14 }}>{fmt(Number(l.Amount))}</span></td>
                        <td><SheetMark text={l.Status} tone={closed ? "done" : "waiting"} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Detail>
      </div>
    </div>
  );
}
