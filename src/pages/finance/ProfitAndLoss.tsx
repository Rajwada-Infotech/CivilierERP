import { useEffect, useState, useCallback, type ReactNode } from "react";
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
  TrendingDown,
  Loader2,
  ChevronDown,
  ChevronRight,
  Target,
  Activity,
  BarChart2,
  Layers,
  Minus,
  Printer,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Info,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Option { id: number; label: string; }
interface Head  { id: number | null; name: string; amount: number; }

interface ExpenseSection {
  key: string;
  label: string;
  heads: Head[];
  total: number;
}

interface Statement {
  revenueFromOperations: { heads: Head[]; total: number };
  otherIncome:           { heads: Head[]; total: number };
  totalRevenue:          number;
  expenseSections:       ExpenseSection[];
  totalExpensesExclTax:  number;
  grossProfit:           number;
  ebitda:                number;
  profitBeforeExceptional: number;
  profitBeforeTax:       number;
  taxExpense:            { heads: Head[]; total: number };
  profitAfterTax:        number;
  // helpers
  directCosts:           number;
  financeCostsTotal:     number;
  depreciationTotal:     number;
  exceptionalTotal:      number;
}

interface StatementGroup { groupId: number | string; groupName: string; heads: Head[]; total: number; }

interface ProfitLossResponse {
  from:         string;
  to:           string;
  companyName:  string | null;
  entityType:   string | null;
  presentation: "structured" | "classic";
  income:       StatementGroup[];
  expenses:     StatementGroup[];
  totals:       { income: number; expenses: number; netProfit: number };
  statement:    Statement | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt     = (n: number) => formatINR(Math.abs(n));
const pct     = (n: number, base: number) => base === 0 ? "—" : `${((n / base) * 100).toFixed(1)}%`;
const romanize = (n: number) =>
  ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"][n - 1] ?? String(n);
const alpha   = (n: number) => String.fromCharCode(96 + n); // 1→a

/** Amount in parentheses for negatives — Indian statutory convention */
function Signed({ amount, className = "" }: { amount: number; className?: string }) {
  const neg = amount < -0.005;
  return (
    <span className={`tabular-nums ${neg ? "text-red-600 dark:text-red-400" : ""} ${className}`}>
      {neg ? "(" : ""}{fmt(amount)}{neg ? ")" : ""}
    </span>
  );
}

/** % of revenue — muted, right-aligned */
function PctCell({ amount, base }: { amount: number; base: number }) {
  if (base === 0) return <span className="text-muted-foreground/40">—</span>;
  const v = (Math.abs(amount) / Math.abs(base)) * 100;
  return <span className="text-muted-foreground/70 tabular-nums">{v.toFixed(1)}%</span>;
}

// ─── Company-type label resolver ─────────────────────────────────────────────

type EntityClass = "construction" | "trading" | "services" | "manufacturing" | "generic";

function classifyEntity(entityType: string | null): EntityClass {
  if (!entityType) return "generic";
  const t = entityType.toLowerCase();
  if (t.includes("construction") || t.includes("real estate") || t.includes("developer") || t.includes("infra")) return "construction";
  if (t.includes("trading") || t.includes("trade")) return "trading";
  if (t.includes("service") || t.includes("it ") || t.includes("software") || t.includes("consult")) return "services";
  if (t.includes("manufactur") || t.includes("factory") || t.includes("production")) return "manufacturing";
  return "generic";
}

function sectionLabel(key: string, cls: EntityClass): string {
  const labels: Record<string, Partial<Record<EntityClass, string>>> = {
    projectExpenses:      { construction: "Contract & Project Costs", generic: "Project & Construction Expenses" },
    costOfMaterials:      { construction: "Cost of Construction Materials", manufacturing: "Cost of Raw Materials Consumed", trading: "Cost of Goods Sold", generic: "Cost of Materials Consumed" },
    purchaseStockInTrade: { trading: "Purchases of Stock-in-Trade", generic: "Purchases of Stock-in-Trade" },
    stockChanges:         { construction: "Changes in WIP / Stock (Completed Projects)", trading: "Changes in Inventories of Stock-in-Trade", manufacturing: "Changes in Inventories (FG, WIP, RM)", generic: "Changes in Inventories of Stock-in-Trade" },
    employeeBenefits:     { construction: "Employee & Labour Benefits Expense", services: "Employee Benefits & Manpower Expense", generic: "Employee Benefits Expense" },
    financeCosts:         {},
    depreciation:         {},
    otherExpenses:        { construction: "Other Project & Administrative Expenses", services: "Other Operating & Administrative Expenses", generic: "Other Expenses" },
    exceptionalItems:     {},
    extraordinaryItems:   {},
  };
  const map = labels[key];
  if (!map) return key;
  return map[cls] ?? map["generic"] ?? key;
}

function revenueLabel(cls: EntityClass): string {
  if (cls === "construction") return "Revenue from Contracts / Operations";
  if (cls === "services")     return "Revenue from Services Rendered";
  if (cls === "trading")      return "Revenue from Sale of Goods";
  return "Revenue from Operations";
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, amount, icon: Icon, variant = "neutral", subtitle,
}: {
  label: string;
  amount: number;
  icon: React.FC<{ size?: number; className?: string }>;
  variant?: "profit" | "loss" | "neutral" | "accent";
  subtitle?: string;
}) {
  const isProfit = amount >= 0;
  const colorMap = {
    profit:  "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20",
    loss:    "from-red-500/10 to-red-500/5 border-red-500/20",
    neutral: "from-primary/8 to-primary/3 border-primary/15",
    accent:  "from-violet-500/10 to-violet-500/5 border-violet-500/20",
  };
  const iconColorMap = {
    profit:  "text-emerald-500",
    loss:    "text-red-500",
    neutral: "text-primary",
    accent:  "text-violet-500",
  };
  const resolvedVariant = variant === "neutral" ? "neutral" : isProfit ? "profit" : "loss";

  return (
    <div className={`relative flex-1 min-w-[150px] rounded-xl border bg-gradient-to-br p-3.5 ${colorMap[resolvedVariant]} transition-all duration-200 hover:shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70 mb-1 truncate">{label}</p>
          <p className={`text-sm font-bold tabular-nums leading-tight ${
            variant === "neutral" || variant === "accent"
              ? "text-foreground"
              : isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}>
            {amount < -0.005 ? "(" : ""}₹{fmt(amount)}{amount < -0.005 ? ")" : ""}
          </p>
          {subtitle && <p className="text-[9px] text-muted-foreground/60 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`rounded-lg p-1.5 bg-background/60 ${iconColorMap[resolvedVariant]}`}>
          <Icon size={13} />
        </div>
      </div>
    </div>
  );
}

// ─── Statement Sheet chrome ───────────────────────────────────────────────────

function StatementSheet({
  companyName, entityType, entityClass, statementName, periodLabel, children,
}: {
  companyName: string | null;
  entityType:  string | null;
  entityClass: EntityClass;
  statementName: string;
  periodLabel:   string;
  children:      ReactNode;
}) {
  const classLabels: Record<EntityClass, string> = {
    construction: "Real Estate & Construction",
    trading:      "Trading",
    services:     "Services",
    manufacturing:"Manufacturing",
    generic:      "General",
  };

  return (
    <div id="pl-printable" className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Letterhead */}
      <div className="px-6 pt-5 pb-4 text-center border-b border-border bg-gradient-to-b from-muted/30 to-transparent">
        <div className="flex items-center justify-center gap-2 mb-1">
          {entityType && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase tracking-wider">
              {classLabels[entityClass]} · {entityType}
            </span>
          )}
        </div>
        <h2 className="text-sm font-heading font-bold tracking-wide text-foreground uppercase mt-1">
          {companyName || "Consolidated — All Companies"}
        </h2>
        <h3 className="text-xs font-semibold text-foreground mt-1.5">{statementName}</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">{periodLabel}</p>
        <p className="text-[9px] text-muted-foreground/55 mt-1">
          (All amounts in Indian Rupees ₹, unless otherwise stated) · As per Schedule III, Division II, Companies Act 2013
        </p>
      </div>
      <div className="px-5 py-4 overflow-x-auto">{children}</div>
    </div>
  );
}

// ─── Structured Statement (Schedule III) ─────────────────────────────────────

function StructuredStatement({
  statement, companyName, entityType, entityClass, periodLabel, priorStatement, priorPeriodLabel, showComparison,
}: {
  statement:         Statement;
  companyName:       string | null;
  entityType:        string | null;
  entityClass:       EntityClass;
  periodLabel:       string;
  priorStatement:    Statement | null;
  priorPeriodLabel:  string;
  showComparison:    boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));

  const showPrior = showComparison && !!priorStatement;
  const base = statement.totalRevenue; // for % column

  // ── Drilldown expansion ──
  const HeadsDrilldown = ({ rowKey, heads }: { rowKey: string; heads: Head[] }) =>
    openKey === rowKey && heads.length > 0 ? (
      <tr>
        <td colSpan={showPrior ? 6 : 5} className="pb-2">
          <div className="ml-8 border-l-2 border-primary/20 pl-3 space-y-0.5 py-1">
            {heads.map((h) => (
              <div key={h.id ?? h.name} className="flex items-center justify-between text-[10px] text-muted-foreground group">
                <span className="truncate pr-3 group-hover:text-foreground transition-colors">{h.name}</span>
                <span className="tabular-nums shrink-0 font-medium">{fmt(h.amount)}</span>
              </div>
            ))}
          </div>
        </td>
      </tr>
    ) : null;

  // ── Row components ──
  const MajorRow = ({
    numeral, label, amount, priorAmount, rowKey, heads, formula, emphasis,
  }: {
    numeral: string; label: string; amount: number; priorAmount?: number;
    rowKey?: string; heads?: Head[]; formula?: string; emphasis?: boolean;
  }) => {
    const clickable = !!rowKey && !!heads?.length;
    return (
      <>
        <tr
          className={`${clickable ? "cursor-pointer hover:bg-muted/30" : ""} ${emphasis ? "bg-muted/20" : ""} transition-colors`}
          onClick={() => clickable && toggle(rowKey!)}
        >
          <td className="py-1.5 pr-1.5 text-[10px] text-muted-foreground align-top w-7 font-mono">{numeral}.</td>
          <td className={`py-1.5 pr-3 text-xs text-foreground ${emphasis ? "font-semibold" : ""}`}>
            {label}
            {formula && <span className="text-[10px] text-muted-foreground ml-1">{formula}</span>}
            {clickable && (
              openKey === rowKey
                ? <ChevronDown size={10} className="inline ml-1.5 -mt-0.5 text-primary/60" />
                : <ChevronRight size={10} className="inline ml-1.5 -mt-0.5 text-muted-foreground/60" />
            )}
          </td>
          <td className="py-1.5 text-right text-[10px] text-muted-foreground/50 w-20 pr-2">
            {rowKey && heads?.length ? (
              <span className="text-[9px] italic">Note</span>
            ) : null}
          </td>
          <td className={`py-1.5 text-right text-xs tabular-nums whitespace-nowrap w-32 ${emphasis ? "font-semibold text-foreground" : "text-foreground"}`}>
            <Signed amount={amount} />
          </td>
          {showPrior && (
            <td className="py-1.5 text-right text-xs tabular-nums whitespace-nowrap w-32 text-muted-foreground/70">
              {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
            </td>
          )}
          <td className="py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap w-16 text-muted-foreground/50">
            <PctCell amount={amount} base={base} />
          </td>
        </tr>
        {rowKey && heads && <HeadsDrilldown rowKey={rowKey} heads={heads} />}
      </>
    );
  };

  const SubRow = ({
    letter, label, amount, priorAmount, rowKey, heads,
  }: {
    letter: string; label: string; amount: number; priorAmount?: number; rowKey: string; heads: Head[];
  }) => {
    const clickable = heads.length > 0;
    return (
      <>
        <tr
          className={`${clickable ? "cursor-pointer hover:bg-muted/30" : ""} transition-colors`}
          onClick={() => clickable && toggle(rowKey)}
        >
          <td className="py-1 pr-1.5 text-[10px] text-muted-foreground/60 align-top w-7 pl-5 font-mono">({letter})</td>
          <td className="py-1 pr-3 text-[11px] text-foreground">
            {label}
            {clickable && (
              openKey === rowKey
                ? <ChevronDown size={9} className="inline ml-1.5 -mt-0.5 text-primary/60" />
                : <ChevronRight size={9} className="inline ml-1.5 -mt-0.5 text-muted-foreground/50" />
            )}
          </td>
          <td className="py-1 text-right text-[10px] text-muted-foreground/40 w-20 pr-2">
            {clickable ? <span className="text-[9px]">{heads.length}</span> : null}
          </td>
          <td className="py-1 text-right text-[11px] tabular-nums text-foreground whitespace-nowrap w-32">
            <Signed amount={amount} />
          </td>
          {showPrior && (
            <td className="py-1 text-right text-[11px] tabular-nums text-muted-foreground/70 whitespace-nowrap w-32">
              {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
            </td>
          )}
          <td className="py-1 text-right text-[10px] tabular-nums text-muted-foreground/50 whitespace-nowrap w-16">
            <PctCell amount={amount} base={base} />
          </td>
        </tr>
        <HeadsDrilldown rowKey={rowKey} heads={heads} />
      </>
    );
  };

  const TotalRow = ({
    label, amount, priorAmount, double: isDouble, variant = "normal", formula,
  }: {
    label: string; amount: number; priorAmount?: number; double?: boolean;
    variant?: "normal" | "subtotal" | "grand";
    formula?: string;
  }) => {
    const isProfit = amount >= 0;
    const grandStyle = variant === "grand"
      ? isProfit
        ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30"
        : "text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-950/30"
      : "";

    return (
      <tr className={`${isDouble ? "border-t-2 border-double border-foreground/40" : "border-t border-border/70"} ${grandStyle}`}>
        <td className="py-1.5 pr-1.5 w-7" />
        <td className={`py-1.5 pr-3 text-xs font-bold text-foreground ${variant === "grand" ? "text-[11px]" : ""}`}>
          {label}
          {formula && <span className="text-[10px] font-normal text-muted-foreground ml-1">{formula}</span>}
        </td>
        <td className="py-1.5 w-20 pr-2" />
        <td className={`py-1.5 text-right text-xs font-bold tabular-nums whitespace-nowrap w-32 ${
          variant === "grand"
            ? isProfit ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            : "text-foreground"
        }`}>
          <Signed amount={amount} />
        </td>
        {showPrior && (
          <td className="py-1.5 text-right text-xs font-bold tabular-nums whitespace-nowrap w-32 text-muted-foreground/70">
            {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
          </td>
        )}
        <td className="py-1.5 text-right text-[10px] tabular-nums text-muted-foreground/50 whitespace-nowrap w-16">
          <PctCell amount={amount} base={base} />
        </td>
      </tr>
    );
  };

  const SectionSpacer = ({ label }: { label: string }) => (
    <tr>
      <td colSpan={showPrior ? 6 : 5} className="pt-3 pb-1">
        <span className="text-xs font-semibold text-foreground">{label}</span>
      </td>
    </tr>
  );

  const DividerRow = () => (
    <tr>
      <td colSpan={showPrior ? 6 : 5} className="py-1">
        <div className="border-t border-dashed border-border/40" />
      </td>
    </tr>
  );

  // ── Section helper: find section from the list ──
  const prior = priorStatement;
  const getPriorSection = (key: string) => prior?.expenseSections.find((s) => s.key === key);

  const revOpLabel = revenueLabel(entityClass);

  return (
    <StatementSheet
      companyName={companyName}
      entityType={entityType}
      entityClass={entityClass}
      statementName="Statement of Profit and Loss"
      periodLabel={periodLabel}
    >
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr className="border-b-2 border-foreground/20">
            <th className="pb-2.5 pr-1.5 text-left w-7" />
            <th className="pb-2.5 pr-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              Particulars
            </th>
            <th className="pb-2.5 pr-2 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-20">
              Note
            </th>
            <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-32">
              {showPrior ? "Current ₹" : "Amount ₹"}
            </th>
            {showPrior && (
              <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 w-32">
                {priorPeriodLabel} ₹
              </th>
            )}
            <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground/50 w-16">
              % Rev
            </th>
          </tr>
        </thead>
        <tbody>

          {/* ── INCOME ── */}
          <MajorRow
            numeral={romanize(1)}
            label={revOpLabel}
            amount={statement.revenueFromOperations.total}
            priorAmount={prior?.revenueFromOperations.total}
            rowKey="rev-ops"
            heads={statement.revenueFromOperations.heads}
          />
          <MajorRow
            numeral={romanize(2)}
            label="Other Income"
            amount={statement.otherIncome.total}
            priorAmount={prior?.otherIncome.total}
            rowKey="other-income"
            heads={statement.otherIncome.heads}
          />
          <TotalRow
            label={`Total Income (${romanize(1)} + ${romanize(2)})`}
            amount={statement.totalRevenue}
            priorAmount={prior?.totalRevenue}
          />
          <DividerRow />

          {/* ── EXPENSES ── */}
          <SectionSpacer label={`${romanize(3)}. Expenses:`} />
          {statement.expenseSections.map((s, i) => (
            <SubRow
              key={s.key}
              letter={alpha(i + 1)}
              label={sectionLabel(s.key, entityClass)}
              amount={s.total}
              priorAmount={getPriorSection(s.key)?.total}
              rowKey={`exp-${s.key}`}
              heads={s.heads}
            />
          ))}
          <TotalRow
            label={`Total Expenses (${romanize(3)})`}
            amount={statement.totalExpensesExclTax}
            priorAmount={prior?.totalExpensesExclTax}
          />
          <DividerRow />

          {/* ── INTERMEDIATE SUBTOTALS ── */}
          {/* Gross Profit */}
          <TotalRow
            label="Gross Profit / (Loss)"
            formula={`(${romanize(1)} − Direct Costs)`}
            amount={statement.grossProfit}
            priorAmount={prior?.grossProfit}
            variant="subtotal"
          />
          {/* EBITDA */}
          <TotalRow
            label="EBITDA"
            formula="(PBT + Finance Costs + D&A)"
            amount={statement.ebitda}
            priorAmount={prior?.ebitda}
            variant="subtotal"
          />

          <DividerRow />

          {/* ── PBT ── */}
          <MajorRow
            numeral={romanize(4)}
            label="Profit / (Loss) Before Exceptional Items and Tax"
            formula={`(${romanize(1)} + ${romanize(2)} − ${romanize(3)})`}
            amount={statement.profitBeforeExceptional}
            priorAmount={prior?.profitBeforeExceptional}
            emphasis
          />
          <MajorRow
            numeral={romanize(5)}
            label="Profit / (Loss) Before Tax"
            formula={`(${romanize(4)} ± Exceptional Items)`}
            amount={statement.profitBeforeTax}
            priorAmount={prior?.profitBeforeTax}
            emphasis
          />

          {/* ── TAX ── */}
          <SectionSpacer label={`${romanize(6)}. Tax Expense:`} />
          {statement.taxExpense.heads.length > 0 ? (
            statement.taxExpense.heads.map((h, i) => (
              <SubRow
                key={h.id ?? h.name}
                letter={alpha(i + 1)}
                label={h.name}
                amount={h.amount}
                rowKey={`tax-${h.id ?? h.name}`}
                heads={[]}
              />
            ))
          ) : (
            <SubRow letter="a" label="Current Tax" amount={0} rowKey="tax-none" heads={[]} />
          )}
          <DividerRow />

          {/* ── NET PROFIT / LOSS ── */}
          <TotalRow
            label={
              statement.profitAfterTax >= 0
                ? `Profit for the Period (${romanize(5)} − ${romanize(6)})`
                : `Loss for the Period (${romanize(5)} − ${romanize(6)})`
            }
            amount={statement.profitAfterTax}
            priorAmount={prior?.profitAfterTax}
            double
            variant="grand"
          />

        </tbody>
      </table>

      {/* ── Notes to Accounts reference ── */}
      <div className="mt-4 pt-3 border-t border-border/50">
        <p className="text-[9px] text-muted-foreground/50 italic">
          The accompanying notes form an integral part of these financial statements. Click any row with a chevron (›) to expand and view individual ledger head details.
        </p>
      </div>
    </StatementSheet>
  );
}

// ─── Classic Trading & P&L (Partnership / Proprietorship) ────────────────────

function ClassicStatement({
  income, expenses, totals, companyName, entityType, entityClass, periodLabel,
}: {
  income:      StatementGroup[];
  expenses:    StatementGroup[];
  totals:      { income: number; expenses: number; netProfit: number };
  companyName: string | null;
  entityType:  string | null;
  entityClass: EntityClass;
  periodLabel: string;
}) {
  const rows = Math.max(expenses.length, income.length);
  const isProfit = totals.netProfit >= 0;

  return (
    <StatementSheet
      companyName={companyName}
      entityType={entityType}
      entityClass={entityClass}
      statementName="Trading and Profit & Loss Account"
      periodLabel={periodLabel}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b-2 border-foreground/25">
              <th className="pb-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground pr-3">
                Expenditure (Dr.)
              </th>
              <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-28">Amount ₹</th>
              <th className="w-6" />
              <th className="pb-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border pl-4 pr-3">
                Income (Cr.)
              </th>
              <th className="pb-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-28">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-xs text-muted-foreground italic">
                  No transactions found for this period.
                </td>
              </tr>
            ) : (
              Array.from({ length: rows }).map((_, i) => {
                const e = expenses[i];
                const inc = income[i];
                return (
                  <tr key={i} className="align-top border-b border-border/25 hover:bg-muted/20 transition-colors">
                    <td className="py-1.5 pr-3 text-[11px] text-foreground">{e ? `To ${e.groupName}` : ""}</td>
                    <td className="py-1.5 text-right text-[11px] tabular-nums text-foreground whitespace-nowrap">{e ? fmt(e.total) : ""}</td>
                    <td className="border-r border-border/30" />
                    <td className="py-1.5 pr-3 text-[11px] text-foreground border-l border-border/30 pl-4">{inc ? `By ${inc.groupName}` : ""}</td>
                    <td className="py-1.5 text-right text-[11px] tabular-nums text-foreground whitespace-nowrap">{inc ? fmt(inc.total) : ""}</td>
                  </tr>
                );
              })
            )}

            {/* Net Profit carried forward */}
            {isProfit && (
              <tr className="border-t border-border">
                <td className="py-1.5 pr-3 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  To Net Profit c/f
                </td>
                <td className="py-1.5 text-right text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                  {fmt(totals.netProfit)}
                </td>
                <td /><td className="border-l border-border/30" /><td />
              </tr>
            )}

            {/* Grand total row */}
            <tr className="border-t-2 border-double border-foreground/35">
              <td className="py-2 pr-3 text-xs font-bold text-foreground">Total</td>
              <td className="py-2 text-right text-xs font-bold tabular-nums text-foreground whitespace-nowrap">
                {fmt(isProfit ? totals.income : totals.expenses)}
              </td>
              <td />
              <td className={`border-l border-border/30 pl-4 py-2 text-xs font-bold ${
                !isProfit ? "text-red-700 dark:text-red-400" : "text-foreground"
              }`}>
                {!isProfit ? "By Net Loss c/f" : "Total"}
              </td>
              <td className="py-2 text-right text-xs font-bold tabular-nums text-foreground whitespace-nowrap">
                {fmt(isProfit ? totals.income : totals.expenses)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </StatementSheet>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

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

  // ── Date state ──
  const now = new Date();
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${fyYear}-04-01`);
  const [to, setTo]     = useState(`${fyYear + 1}-03-31`);

  // ── Filters ──
  const [companies,    setCompanies]    = useState<Option[]>([]);
  const [projects,     setProjects]     = useState<Option[]>([]);
  const [costCentres,  setCostCentres]  = useState<Option[]>([]);
  const [companyId,    setCompanyId]    = useState<number | null>(null);
  const [projectId,    setProjectId]    = useState<number | null>(null);
  const [costCentreId, setCostCentreId] = useState<number | null>(null);

  // ── Comparison ──
  const [showComparison, setShowComparison] = useState(false);
  const [priorData,      setPriorData]      = useState<ProfitLossResponse | null>(null);
  const [priorLoading,   setPriorLoading]   = useState(false);

  // ── Data ──
  const [data,    setData]    = useState<ProfitLossResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Load dropdowns ──
  useEffect(() => {
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json()).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/cost-center/options")
      .then((r) => r.json()).then((d) => setCostCentres(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // ── Shift dates by one year back (for prior period) ──
  const shiftYear = (dateStr: string, delta: number) => {
    const d = new Date(dateStr);
    d.setFullYear(d.getFullYear() + delta);
    return d.toISOString().slice(0, 10);
  };

  // ── Fetch ──
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

    // Prior period (shifted by -1 year)
    if (showComparison) {
      setPriorLoading(true);
      const pqs = new URLSearchParams({ from: shiftYear(from, -1), to: shiftYear(to, -1) });
      if (companyId)    pqs.set("companyId",    String(companyId));
      if (projectId)    pqs.set("projectId",    String(projectId));
      if (costCentreId) pqs.set("costCenterId", String(costCentreId));
      fetchWithAuth(`/api/financial-statements/profit-loss?${pqs.toString()}`)
        .then((r) => r.json()).then((d) => setPriorData(d)).catch(() => setPriorData(null))
        .finally(() => setPriorLoading(false));
    } else {
      setPriorData(null);
    }
  }, [from, to, companyId, projectId, costCentreId, showComparison]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Quick FY Buttons ──
  const isActiveFy = from === `${fyYear}-04-01` && to === `${fyYear + 1}-03-31`;
  const setQ = (q: 1|2|3|4) => {
    const quarters: Record<1|2|3|4, [string, string]> = {
      1: [`${fyYear}-04-01`, `${fyYear}-06-30`],
      2: [`${fyYear}-07-01`, `${fyYear}-09-30`],
      3: [`${fyYear}-10-01`, `${fyYear}-12-31`],
      4: [`${fyYear + 1}-01-01`, `${fyYear + 1}-03-31`],
    };
    const [f, t] = quarters[q];
    setFrom(f); setTo(t);
  };

  // ── Export data ──
  const exportColumns: ExportColumn[] = [
    { header: "Side",   accessor: "side" },
    { header: "Group",  accessor: "group" },
    { header: "Head",   accessor: "head" },
    { header: "Amount", accessor: "amount" },
  ];
  const exportRows = data
    ? [
        ...data.expenses.flatMap((g) =>
          g.heads.map((h) => ({ side: "Expenditure", group: g.groupName, head: h.name, amount: h.amount })),
        ),
        ...data.income.flatMap((g) =>
          g.heads.map((h) => ({ side: "Income", group: g.groupName, head: h.name, amount: h.amount })),
        ),
      ]
    : [];

  // ── Derived UI ──
  const periodLabel = data
    ? `For the period ${new Date(data.from).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} to ${new Date(data.to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
    : "";

  const priorPeriodLabel = priorData
    ? `${new Date(priorData.from).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} – ${new Date(priorData.to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
    : "Prior Year";

  const entityClass = classifyEntity(data?.entityType ?? null);

  const st  = data?.statement ?? null;
  const pst = priorData?.statement ?? null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Profit & Loss"]} />
      <FinanceShell
        title="Profit & Loss"
        subtitle="Statement of Income & Expenditure as per Schedule III, Companies Act 2013"
        icon={TrendingUp}
      >

        {/* ── Filter Toolbar ── */}
        <div className="mb-5 rounded-xl border border-border bg-muted/20 p-4 space-y-3">

          {/* Quick FY Buttons */}
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

            {/* Comparison toggle */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowComparison((v) => !v)}
                className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-[10px] font-medium transition-all border ${
                  showComparison
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {showComparison ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                vs Prior Year
              </button>
            </div>
          </div>

          {/* Date + Filters row */}
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
                  <Target size={9} /> Cost Centre
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

            {/* Action buttons */}
            <div className="flex items-end gap-2 ml-auto">
              {/* Print */}
              <button
                onClick={() => window.print()}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
              >
                <Printer size={12} /> Print
              </button>
              <button
                onClick={fetchData}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
              {rights.canExport && data && (
                <ExportMenu title="Profit & Loss" filename="profit-and-loss" columns={exportColumns} data={exportRows} />
              )}
            </div>
          </div>
        </div>

        {/* ── Loading / Error ── */}
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

        {/* ── Main Content ── */}
        {!loading && !error && data && (() => {

          /* ── KPI Summary Bar (structured view only) ── */
          const showKpi = data.presentation === "structured" && st;
          const netFigure = data.totals.netProfit;

          return (
            <>
              {/* KPI Bar */}
              {showKpi && st && (
                <div className="mb-5">
                  {/* Profit/Loss headline */}
                  <div className={`mb-3 rounded-xl border p-4 flex items-center justify-between gap-4 bg-gradient-to-r ${
                    st.profitAfterTax >= 0
                      ? "from-emerald-500/10 to-emerald-500/5 border-emerald-500/25"
                      : "from-red-500/10 to-red-500/5 border-red-500/25"
                  }`}>
                    <div>
                      <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70 mb-0.5">
                        {st.profitAfterTax >= 0 ? "Net Profit After Tax" : "Net Loss After Tax"}
                      </p>
                      <p className={`text-2xl font-bold tabular-nums tracking-tight ${
                        st.profitAfterTax >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-700 dark:text-red-400"
                      }`}>
                        {st.profitAfterTax < 0 ? "(" : ""}₹{fmt(st.profitAfterTax)}{st.profitAfterTax < 0 ? ")" : ""}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{periodLabel}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Net profit margin badge */}
                      {st.totalRevenue !== 0 && (
                        <div className={`rounded-lg px-3 py-2 text-center ${
                          st.profitAfterTax >= 0
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-500/15 text-red-700 dark:text-red-400"
                        }`}>
                          <p className="text-[9px] font-heading uppercase tracking-widest opacity-70">Net Margin</p>
                          <p className="text-lg font-bold">{pct(st.profitAfterTax, st.totalRevenue)}</p>
                        </div>
                      )}
                      {st.profitAfterTax >= 0
                        ? <TrendingUp size={32} className="text-emerald-500/40" />
                        : <TrendingDown size={32} className="text-red-500/40" />
                      }
                    </div>
                  </div>

                  {/* Sub KPI cards */}
                  <div className="flex flex-wrap gap-3">
                    <KpiCard
                      label="Revenue from Operations"
                      amount={st.revenueFromOperations.total}
                      icon={BarChart2}
                      variant="neutral"
                      subtitle={`+ ₹${fmt(st.otherIncome.total)} other income`}
                    />
                    <KpiCard
                      label="Gross Profit / (Loss)"
                      amount={st.grossProfit}
                      icon={Layers}
                      subtitle={`Margin: ${pct(st.grossProfit, st.revenueFromOperations.total)}`}
                    />
                    <KpiCard
                      label="EBITDA"
                      amount={st.ebitda}
                      icon={Activity}
                      variant="accent"
                      subtitle={`Margin: ${pct(st.ebitda, st.totalRevenue)}`}
                    />
                    <KpiCard
                      label="Profit Before Tax"
                      amount={st.profitBeforeTax}
                      icon={Target}
                      subtitle={`Tax: ₹${fmt(st.taxExpense.total)}`}
                    />
                  </div>

                  {/* Comparison note */}
                  {showComparison && priorLoading && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 size={11} className="animate-spin" /> Loading prior year data…
                    </div>
                  )}
                  {showComparison && !priorLoading && priorData && pst && (
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <span className="text-[10px] text-muted-foreground/60 font-heading uppercase tracking-wider">vs Prior Year:</span>
                      {[
                        { label: "Revenue", cur: st.totalRevenue, pri: pst.totalRevenue },
                        { label: "Gross Profit", cur: st.grossProfit, pri: pst.grossProfit },
                        { label: "PAT", cur: st.profitAfterTax, pri: pst.profitAfterTax },
                      ].map(({ label, cur, pri }) => {
                        const delta = cur - pri;
                        const isUp = delta >= 0;
                        return (
                          <span key={label} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
                            isUp
                              ? "bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400"
                              : "bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400"
                          }`}>
                            {label}: {isUp ? "▲" : "▼"} ₹{fmt(Math.abs(delta))}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Statement */}
              {loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Loader2 size={11} className="animate-spin" /> Refreshing…
                </div>
              )}

              {data.presentation === "structured" && st ? (
                <StructuredStatement
                  statement={st}
                  companyName={data.companyName}
                  entityType={data.entityType}
                  entityClass={entityClass}
                  periodLabel={periodLabel}
                  priorStatement={pst}
                  priorPeriodLabel={priorPeriodLabel}
                  showComparison={showComparison && !!pst}
                />
              ) : (
                <ClassicStatement
                  income={data.income}
                  expenses={data.expenses}
                  totals={data.totals}
                  companyName={data.companyName}
                  entityType={data.entityType}
                  entityClass={entityClass}
                  periodLabel={periodLabel}
                />
              )}

              {/* Entity-type info note */}
              {data.entityType && (
                <div className="mt-4 flex items-start gap-2 text-[10px] text-muted-foreground/60">
                  <Info size={11} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>{data.entityType}</strong> · Presenting as{" "}
                    {data.presentation === "structured"
                      ? "Schedule III, Division II (Companies Act 2013) — Structured vertical format"
                      : "Classic Trading & P&L Account — Traditional Dr/Cr format for non-corporate entities"
                    }.
                    {entityClass !== "generic" && ` Industry classification: ${entityClass.charAt(0).toUpperCase() + entityClass.slice(1)} — sector-specific line item labels applied.`}
                  </span>
                </div>
              )}
            </>
          );
        })()}

        {/* Empty state */}
        {!loading && !error && !data && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Minus size={32} className="opacity-30" />
            <p className="text-sm">Select a period and click Refresh to load the statement.</p>
          </div>
        )}

      </FinanceShell>

      {/* ── Print styles ── */}
      <style>{`
        @media print {
          body > *:not(#pl-printable) { display: none !important; }
          #pl-printable { display: block !important; box-shadow: none !important; border: none !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </>
  );
}
