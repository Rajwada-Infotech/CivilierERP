import { useEffect, useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  RefreshCw,
  CalendarDays,
  Building,
  FolderKanban,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronRight,
  Minus,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
// Mirrors the classic Trading and Profit & Loss Account: two T-accounts, each
// a Dr (expenditure) side and a Cr (income) side that must total the same on
// both sides — the Trading Account isolates direct/production costs against
// Revenue to find Gross Profit, which carries down into the P&L Account
// alongside Other Income, against indirect expenses and tax, to find Net
// Profit. See backend/routes/financialStatements.js's /profit-loss handler.

interface Option { id: number; label: string; }
interface Head  { id: number | null; name: string; amount: number; }
interface Section { key: string; label: string; heads: Head[]; total: number; }
interface IncomeBlock { heads: Head[]; total: number; }
interface StatementGroup { groupId: number | string; groupName: string; heads: Head[]; total: number; }

interface TradingAccount {
  dr: { expenseSections: Section[]; total: number; grossProfit: number };
  cr: { revenueFromOperations: IncomeBlock };
  total: number;
}
interface ProfitAndLossAccount {
  dr: { expenseSections: Section[]; total: number; taxExpense: IncomeBlock; profitBeforeTax: number; netProfit: number };
  cr: { grossProfitBroughtDown: number; otherIncome: IncomeBlock };
  total: number;
}

interface ProfitLossResponse {
  from:        string;
  to:          string;
  companyName: string | null;
  entityType:  string | null;
  income:      StatementGroup[];
  expenses:    StatementGroup[];
  totals:      { income: number; expenses: number; netProfit: number };
  tradingAccount:       TradingAccount;
  profitAndLossAccount: ProfitAndLossAccount;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => formatINR(Math.abs(n));

/** Amount in parentheses for negatives — Indian statutory convention */
function Signed({ amount }: { amount: number }) {
  const neg = amount < -0.005;
  return (
    <span className={`tabular-nums ${neg ? "text-red-600 dark:text-red-400" : ""}`}>
      {neg ? "(" : ""}{fmt(amount)}{neg ? ")" : ""}
    </span>
  );
}

// ─── Statement chrome (letterhead) ────────────────────────────────────────────

function StatementSheet({
  companyName, statementName, periodLabel, children,
}: {
  companyName:   string | null;
  statementName: string;
  periodLabel:   string;
  children:      React.ReactNode;
}) {
  return (
    <div className="pl-printable rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-4 text-center border-b border-border bg-gradient-to-b from-muted/30 to-transparent">
        <h2 className="text-sm font-heading font-bold tracking-wide text-foreground uppercase">
          {companyName || "Consolidated — All Companies"}
        </h2>
        <h3 className="text-xs font-semibold text-foreground mt-1.5">{statementName}</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">{periodLabel}</p>
        <p className="text-[9px] text-muted-foreground/55 mt-1">(All amounts in Indian Rupees ₹, unless otherwise stated)</p>
      </div>
      <div className="px-5 py-4 overflow-x-auto">{children}</div>
    </div>
  );
}

// ─── One T-account (Dr | Cr) ─────────────────────────────────────────────────
// Renders one side of a two-account statement. `drRows`/`crRows` are already-
// resolved {label, amount, heads?} lines; a row with heads can expand inline
// to show the individual ledger heads behind its total, same drill-down
// convention Trial Balance and the old Schedule III statement both used.

interface Row { key: string; label: string; amount: number; heads?: Head[]; bold?: boolean; tone?: "profit" | "loss"; }

function ExpandableRow({
  row, side, openKey, onToggle,
}: {
  row: Row;
  side: "dr" | "cr";
  openKey: string | null;
  onToggle: (k: string) => void;
}) {
  const clickable = !!row.heads?.length;
  const isOpen = openKey === row.key;
  const toneCls =
    row.tone === "profit" ? "text-emerald-700 dark:text-emerald-400" :
    row.tone === "loss"   ? "text-red-700 dark:text-red-400" : "text-foreground";

  return (
    <>
      <tr
        className={`${clickable ? "cursor-pointer hover:bg-muted/30" : ""} transition-colors`}
        onClick={() => clickable && onToggle(row.key)}
      >
        <td className={`py-1.5 pr-3 text-[11px] ${row.bold ? `font-semibold ${toneCls}` : "text-foreground"}`}>
          {side === "dr" ? "To " : "By "}{row.label}
          {clickable && (
            isOpen
              ? <ChevronDown size={10} className="inline ml-1.5 -mt-0.5 text-primary/60" />
              : <ChevronRight size={10} className="inline ml-1.5 -mt-0.5 text-muted-foreground/60" />
          )}
        </td>
        <td className={`py-1.5 text-right text-[11px] tabular-nums whitespace-nowrap ${row.bold ? `font-semibold ${toneCls}` : "text-foreground"}`}>
          <Signed amount={row.amount} />
        </td>
      </tr>
      {isOpen && row.heads?.length ? (
        <tr>
          <td colSpan={2} className="pb-2">
            <div className="ml-4 border-l-2 border-primary/20 pl-3 space-y-0.5 py-1">
              {row.heads.map((h) => (
                <div key={h.id ?? h.name} className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate pr-3">{h.name}</span>
                  <span className="tabular-nums shrink-0 font-medium">{fmt(h.amount)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// One side (Dr or Cr) of a T-account — an independent table, so each side's
// rows can expand/collapse on their own without needing to stay index-
// aligned with the other side (a Dr row expanding shouldn't shift the Cr
// row sitting next to it out of place).
function AccountSide({
  side, rows, total, openKey, onToggle,
}: {
  side: "dr" | "cr";
  rows: Row[];
  total: number;
  openKey: string | null;
  onToggle: (k: string) => void;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-foreground/25">
          <th className="pb-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground pr-3">
            {side === "dr" ? "Dr." : "Cr."}
          </th>
          <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-28">Amount ₹</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2} className="py-6 text-center text-xs text-muted-foreground italic">Nil</td>
          </tr>
        ) : (
          rows.map((row) => (
            <ExpandableRow key={row.key} row={row} side={side} openKey={openKey} onToggle={onToggle} />
          ))
        )}
        <tr className="border-t-2 border-double border-foreground/35">
          <td className="py-2 pr-3 text-xs font-bold text-foreground">Total</td>
          <td className="py-2 text-right text-xs font-bold tabular-nums text-foreground whitespace-nowrap">{fmt(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function TAccount({
  companyName, statementName, periodLabel, drRows, crRows, total,
}: {
  companyName:   string | null;
  statementName: string;
  periodLabel:   string;
  drRows: Row[];
  crRows: Row[];
  total:  number;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));

  return (
    <StatementSheet companyName={companyName} statementName={statementName} periodLabel={periodLabel}>
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-border gap-4 sm:gap-0 min-w-[520px]">
        <div className="sm:pr-4"><AccountSide side="dr" rows={drRows} total={total} openKey={openKey} onToggle={toggle} /></div>
        <div className="sm:pl-4"><AccountSide side="cr" rows={crRows} total={total} openKey={openKey} onToggle={toggle} /></div>
      </div>
    </StatementSheet>
  );
}

// Turns an expense Section[] into Row[] — one line per section, expandable
// to the individual heads behind it.
const sectionsToRows = (sections: Section[]): Row[] =>
  sections.map((s) => ({ key: s.key, label: s.label, amount: s.total, heads: s.heads }));

// ─── Filter Bar helpers ────────────────────────────────────────────────────

function QuickFYButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 h-7 rounded-md text-[10px] font-medium transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/50"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProfitAndLoss() {
  const rights = usePageRights("profit-and-loss");

  const now = new Date();
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${fyYear}-04-01`);
  const [to, setTo]     = useState(`${fyYear + 1}-03-31`);

  const [companies,    setCompanies]    = useState<Option[]>([]);
  const [projects,     setProjects]     = useState<Option[]>([]);
  const [costCentres,  setCostCentres]  = useState<Option[]>([]);
  const [companyId,    setCompanyId]    = useState<number | null>(null);
  const [projectId,    setProjectId]    = useState<number | null>(null);
  const [costCentreId, setCostCentreId] = useState<number | null>(null);

  const [data,    setData]    = useState<ProfitLossResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json()).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/cost-center/options")
      .then((r) => r.json()).then((d) => setCostCentres(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, to });
    if (companyId)    qs.set("companyId",    String(companyId));
    if (projectId)    qs.set("projectId",    String(projectId));
    if (costCentreId) qs.set("costCenterId", String(costCentreId));

    fetchWithAuth(`/api/financial-statements/profit-loss?${qs.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setData(d))
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [from, to, companyId, projectId, costCentreId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isActiveFy = from === `${fyYear}-04-01` && to === `${fyYear + 1}-03-31`;
  const setQ = (q: 1 | 2 | 3 | 4) => {
    const quarters: Record<1 | 2 | 3 | 4, [string, string]> = {
      1: [`${fyYear}-04-01`, `${fyYear}-06-30`],
      2: [`${fyYear}-07-01`, `${fyYear}-09-30`],
      3: [`${fyYear}-10-01`, `${fyYear}-12-31`],
      4: [`${fyYear + 1}-01-01`, `${fyYear + 1}-03-31`],
    };
    const [f, t] = quarters[q];
    setFrom(f); setTo(t);
  };

  const exportColumns: ExportColumn[] = [
    { header: "Side",   accessor: "side" },
    { header: "Group",  accessor: "group" },
    { header: "Head",   accessor: "head" },
    { header: "Amount", accessor: "amount" },
  ];
  const exportRows = data
    ? [
        ...data.expenses.flatMap((g) => g.heads.map((h) => ({ side: "Expenditure", group: g.groupName, head: h.name, amount: h.amount }))),
        ...data.income.flatMap((g) => g.heads.map((h) => ({ side: "Income", group: g.groupName, head: h.name, amount: h.amount }))),
      ]
    : [];

  const periodLabel = data
    ? `For the period ${new Date(data.from).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} to ${new Date(data.to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
    : "";

  // ── Build the two T-accounts' Dr/Cr rows from the API response ──
  let tradingDr: Row[] = [];
  let tradingCr: Row[] = [];
  let tradingTotal = 0;
  let plDr: Row[] = [];
  let plCr: Row[] = [];
  let plTotal = 0;

  if (data) {
    const ta = data.tradingAccount;
    const pl = data.profitAndLossAccount;
    const grossProfit = ta.dr.grossProfit;

    tradingDr = sectionsToRows(ta.dr.expenseSections);
    tradingCr = [{ key: "revenue-ops", label: "Revenue from Operations", amount: ta.cr.revenueFromOperations.total, heads: ta.cr.revenueFromOperations.heads }];
    if (grossProfit >= 0) {
      tradingDr.push({ key: "gross-profit", label: "Gross Profit c/d", amount: grossProfit, bold: true, tone: "profit" });
    } else {
      tradingCr.push({ key: "gross-loss", label: "Gross Loss c/d", amount: -grossProfit, bold: true, tone: "loss" });
    }
    tradingTotal = ta.total;

    plDr = sectionsToRows(pl.dr.expenseSections);
    if (pl.dr.taxExpense.total > 0.005) {
      plDr.push({ key: "tax-expense", label: "Tax Expense", amount: pl.dr.taxExpense.total, heads: pl.dr.taxExpense.heads });
    }
    plCr = [{
      key: "gross-profit-bd",
      label: grossProfit >= 0 ? "Gross Profit b/d" : "Gross Loss b/d",
      amount: Math.abs(grossProfit),
      tone: grossProfit >= 0 ? "profit" : "loss",
    }];
    if (grossProfit < 0) {
      // A gross loss is itself a debit into the P&L Account, not a credit.
      plCr.shift();
      plDr.unshift({ key: "gross-loss-bd", label: "Gross Loss b/d", amount: -grossProfit, tone: "loss" });
    }
    plCr.push({ key: "other-income", label: "Other Income", amount: pl.cr.otherIncome.total, heads: pl.cr.otherIncome.heads });
    if (pl.dr.netProfit >= 0) {
      plDr.push({ key: "net-profit", label: "Net Profit", amount: pl.dr.netProfit, bold: true, tone: "profit" });
    } else {
      plCr.push({ key: "net-loss", label: "Net Loss", amount: -pl.dr.netProfit, bold: true, tone: "loss" });
    }
    plTotal = pl.total;
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Profit & Loss"]} />
      <FinanceShell
        title="Profit & Loss"
        subtitle="Trading and Profit & Loss Account"
        icon={TrendingUp}
      >
        {/* ── Filter Toolbar ── */}
        <div className="mb-5 rounded-xl border border-border bg-muted/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mr-1">Quick Select</span>
            <QuickFYButton
              label={`FY ${fyYear}–${String(fyYear + 1).slice(-2)}`}
              active={isActiveFy}
              onClick={() => { setFrom(`${fyYear}-04-01`); setTo(`${fyYear + 1}-03-31`); }}
            />
            <QuickFYButton label="Q1 Apr–Jun" active={from === `${fyYear}-04-01` && to === `${fyYear}-06-30`} onClick={() => setQ(1)} />
            <QuickFYButton label="Q2 Jul–Sep" active={from === `${fyYear}-07-01` && to === `${fyYear}-09-30`} onClick={() => setQ(2)} />
            <QuickFYButton label="Q3 Oct–Dec" active={from === `${fyYear}-10-01` && to === `${fyYear}-12-31`} onClick={() => setQ(3)} />
            <QuickFYButton label="Q4 Jan–Mar" active={from === `${fyYear + 1}-01-01` && to === `${fyYear + 1}-03-31`} onClick={() => setQ(4)} />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                <CalendarDays size={9} /> From
              </span>
              <input
                type="date" value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                <CalendarDays size={9} /> To
              </span>
              <input
                type="date" value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex flex-col gap-0.5 min-w-[160px]">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                <Building size={9} /> Company
              </span>
              <select
                value={companyId ?? ""}
                onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}
                className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">All Companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0.5 min-w-[160px]">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                <FolderKanban size={9} /> Project
              </span>
              <select
                value={projectId ?? ""}
                onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
                className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {costCentres.length > 0 && (
              <div className="flex flex-col gap-0.5 min-w-[160px]">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                  Cost Centre
                </span>
                <select
                  value={costCentreId ?? ""}
                  onChange={(e) => setCostCentreId(e.target.value ? Number(e.target.value) : null)}
                  className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">All Cost Centres</option>
                  {costCentres.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-end gap-2 ml-auto">
              <button
                onClick={fetchData}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
              {rights.canExport && data && (
                <ExportMenu
                  title="Profit & Loss"
                  filename="profit-and-loss"
                  columns={exportColumns}
                  data={exportRows}
                  onPrint={() => window.print()}
                />
              )}
            </div>
          </div>
        </div>

        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={16} /> Loading statement…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 py-6 px-4 rounded-xl bg-red-50/50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-5">
            <TAccount
              companyName={data.companyName}
              statementName="Trading Account"
              periodLabel={periodLabel}
              drRows={tradingDr}
              crRows={tradingCr}
              total={tradingTotal}
            />
            <TAccount
              companyName={data.companyName}
              statementName="Profit and Loss Account"
              periodLabel={periodLabel}
              drRows={plDr}
              crRows={plCr}
              total={plTotal}
            />
          </div>
        )}

        {!loading && !error && !data && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Minus size={32} className="opacity-30" />
            <p className="text-sm">Select a period and click Refresh to load the statement.</p>
          </div>
        )}
      </FinanceShell>

      {/* ── Print styles ──
          #pl-printable sits many levels deep inside the app's layout tree
          (sidebar shell, content wrappers, ...), not as a direct child of
          <body> — a `body > *:not(#pl-printable) { display: none }` rule
          only ever matches body's immediate children, so it hid the app's
          root wrapper (not the printable sheet itself) and took the
          printable content down with it, printing a blank page.
          `visibility: hidden` on everything, then `visibility: visible`
          back on just the target and its descendants, works regardless of
          nesting depth. A shared class (not id — there are two sheets,
          Trading + P&L accounts, and ids must be unique) covers both. ── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pl-printable, .pl-printable * { visibility: visible !important; }
          .pl-printable, .pl-printable * {
            color: #000 !important;
            background-color: transparent !important;
            border-color: #999 !important;
          }
          .pl-printable {
            position: relative !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 0 16px 0 !important;
            box-shadow: none !important;
            border: none !important;
            page-break-inside: avoid;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </>
  );
}
