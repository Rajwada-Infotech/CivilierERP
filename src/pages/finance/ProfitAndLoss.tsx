import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
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
  Loader2,
  ChevronDown,
  ChevronRight,
  Target,
  Minus,
  AlertCircle,
  Info,
} from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

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
  totalExpenses:         number;
  grossProfit:           number;
  netProfit:             number;
  // helpers
  directCosts:           number;
  indirectTotal:         number;
  taxExpense:            { heads: Head[]; total: number };
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
    <span className={`tabular-nums ${neg ? "text-destructive" : ""} ${className}`}>
      {neg ? "(" : ""}{fmt(amount)}{neg ? ")" : ""}
    </span>
  );
}

/** % of revenue — muted, right-aligned */
function PctCell({ amount, base }: { amount: number; base: number }) {
  if (base === 0) return <span className="text-muted-foreground/50">—</span>;
  const v = (Math.abs(amount) / Math.abs(base)) * 100;
  return <span className="text-muted-foreground tabular-nums">{v.toFixed(1)}%</span>;
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
    <div id="pl-printable" className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
      {/* Letterhead */}
      <div className="px-6 pt-5 pb-4 text-center" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
        {entityType && (
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
            {classLabels[entityClass]} · {entityType}
          </p>
        )}
        <h2 className="font-heading text-sm font-bold tracking-[0.1em] text-foreground uppercase">
          {companyName || "Consolidated: all companies"}
        </h2>
        <h3 className="font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground mt-2">{statementName}</h3>
        <p className="text-[0.75rem] text-muted-foreground mt-1 tabular-nums">{periodLabel}</p>
        <p className="text-[0.625rem] text-muted-foreground mt-1">
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

  // Printing should show every ledger-head drilldown at once, not just
  // whichever single row happens to be expanded on screen — openKey is a
  // one-at-a-time accordion by design for interactive use, so this is a
  // separate override rather than changing that. beforeprint/afterprint
  // fire for any print trigger (the toolbar button or Ctrl+P alike).
  const [printExpandAll, setPrintExpandAll] = useState(false);
  useEffect(() => {
    const onBeforePrint = () => setPrintExpandAll(true);
    const onAfterPrint = () => setPrintExpandAll(false);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  const showPrior = showComparison && !!priorStatement;
  const base = statement.totalRevenue; // for % column

  // ── Drilldown expansion ──
  const HeadsDrilldown = ({ rowKey, heads }: { rowKey: string; heads: Head[] }) =>
    (printExpandAll || openKey === rowKey) && heads.length > 0 ? (
      <tr>
        <td colSpan={showPrior ? 6 : 5} className="pb-2">
          <div className="ml-8 pl-3 space-y-1 py-1" style={{ borderLeft: "1px solid hsl(var(--foreground))" }}>
            {heads.map((h) => (
              <div key={h.id ?? h.name} className="flex items-center justify-between text-[0.6875rem] text-muted-foreground group">
                <span className="truncate pr-3 group-hover:text-foreground transition-colors">{h.name}</span>
                <span className="font-heading tabular-nums shrink-0 font-medium text-foreground">{fmt(h.amount)}</span>
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
          className={`r-line ${clickable ? "r-click cursor-pointer" : ""}`}
          onClick={() => clickable && toggle(rowKey!)}
        >
          <td className="py-1.5 pr-1.5 text-[0.625rem] text-muted-foreground align-top w-7 font-heading font-semibold tabular-nums">{numeral}.</td>
          <td className={`py-1.5 pr-3 text-xs text-foreground ${emphasis ? "font-semibold" : ""}`}>
            {label}
            {formula && <span className="text-[0.625rem] text-muted-foreground ml-1">{formula}</span>}
            {clickable && (
              printExpandAll || openKey === rowKey
                ? <ChevronDown size={11} className="inline ml-1.5 -mt-0.5 text-foreground" />
                : <ChevronRight size={11} className="inline ml-1.5 -mt-0.5 text-foreground" />
            )}
          </td>
          <td className="py-1.5 text-right text-[0.625rem] text-muted-foreground/50 w-20 pr-2">
            {rowKey && heads?.length ? (
              <span className="text-[0.5625rem]">Note</span>
            ) : null}
          </td>
          <td className={`py-1.5 text-right font-heading text-xs tabular-nums whitespace-nowrap w-32 ${emphasis ? "font-semibold text-foreground" : "text-foreground"}`}>
            <Signed amount={amount} />
          </td>
          {showPrior && (
            <td className="py-1.5 text-right font-heading text-xs tabular-nums whitespace-nowrap w-32 text-muted-foreground">
              {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
            </td>
          )}
          <td className="py-1.5 text-right text-[0.625rem] tabular-nums whitespace-nowrap w-16 text-muted-foreground/50">
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
          className={`r-line ${clickable ? "r-click cursor-pointer" : ""}`}
          onClick={() => clickable && toggle(rowKey)}
        >
          <td className="py-1 pr-1.5 text-[0.625rem] text-muted-foreground align-top w-7 pl-5 font-heading tabular-nums">({letter})</td>
          <td className="py-1 pr-3 text-[0.6875rem] text-foreground">
            {label}
            {clickable && (
              printExpandAll || openKey === rowKey
                ? <ChevronDown size={11} className="inline ml-1.5 -mt-0.5 text-foreground" />
                : <ChevronRight size={11} className="inline ml-1.5 -mt-0.5 text-foreground" />
            )}
          </td>
          <td className="py-1 text-right text-[0.625rem] text-muted-foreground/40 w-20 pr-2">
            {clickable ? <span className="text-[0.5625rem]">{heads.length}</span> : null}
          </td>
          <td className="py-1 text-right font-heading text-[0.6875rem] tabular-nums text-foreground whitespace-nowrap w-32">
            <Signed amount={amount} />
          </td>
          {showPrior && (
            <td className="py-1 text-right font-heading text-[0.6875rem] tabular-nums text-muted-foreground whitespace-nowrap w-32">
              {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
            </td>
          )}
          <td className="py-1 text-right text-[0.625rem] tabular-nums text-muted-foreground/50 whitespace-nowrap w-16">
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
    // Sub-totals sit on an ink rule; the closing figure on a heavy one. A loss is the only figure in red (it carries its brackets too).
    return (
      <tr className={isDouble || variant === "grand" ? "r-total" : "r-sub"}>
        <td className="py-2 pr-1.5 w-7" />
        <td className={`py-2 pr-3 text-foreground ${variant === "grand" ? "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.12em]" : "text-xs font-bold"}`}>
          {label}
          {formula && <span className="text-[0.625rem] font-normal normal-case tracking-normal text-muted-foreground ml-1.5">{formula}</span>}
        </td>
        <td className="py-2 w-20 pr-2" />
        <td className={`py-2 text-right font-heading font-bold tabular-nums whitespace-nowrap w-32 text-foreground ${variant === "grand" ? "text-[0.8125rem]" : "text-xs"}`}>
          <Signed amount={amount} />
        </td>
        {showPrior && (
          <td className="py-2 text-right font-heading text-xs font-semibold tabular-nums whitespace-nowrap w-32 text-muted-foreground">
            {priorAmount !== undefined ? <Signed amount={priorAmount} /> : "—"}
          </td>
        )}
        <td className="py-2 text-right font-heading text-[0.625rem] tabular-nums text-muted-foreground whitespace-nowrap w-16">
          <PctCell amount={amount} base={base} />
        </td>
      </tr>
    );
  };

  const SectionSpacer = ({ label }: { label: string }) => (
    <tr>
      <td colSpan={showPrior ? 6 : 5} className="pt-3 pb-1">
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-foreground">{label}</span>
      </td>
    </tr>
  );

  const DividerRow = () => (
    <tr>
      <td colSpan={showPrior ? 6 : 5} className="py-1.5" />
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
          <tr>
            <th className="pb-2.5 pr-1.5 text-left w-7" />
            <th className="pb-2.5 pr-3 text-left">
              Particulars
            </th>
            <th className="pb-2.5 pr-2 text-right w-20">
              Note
            </th>
            <th className="pb-2.5 text-right w-32">
              {showPrior ? "Current ₹" : "Amount ₹"}
            </th>
            {showPrior && (
              <th className="pb-2.5 text-right w-32">
                {priorPeriodLabel} ₹
              </th>
            )}
            <th className="pb-2.5 text-right w-16">
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

          {/* ── EXPENSES — Direct, then Gross Profit as the Trading-Account
              carry-forward, then Indirect, matching the classic Trading &
              P&L Account flow rather than listing both expense rows before
              any subtotal. ── */}
          <SectionSpacer label={`${romanize(3)}. Expenses:`} />
          {(() => {
            const directSection = statement.expenseSections.find((s) => s.key === "directExpenses");
            const indirectSection = statement.expenseSections.find((s) => s.key === "indirectExpenses");
            const otherSections = statement.expenseSections.filter(
              (s) => s.key !== "directExpenses" && s.key !== "indirectExpenses",
            );
            return (
              <>
                {directSection && (
                  <SubRow
                    letter="a"
                    label={directSection.label ?? sectionLabel(directSection.key, entityClass)}
                    amount={directSection.total}
                    priorAmount={getPriorSection(directSection.key)?.total}
                    rowKey={`exp-${directSection.key}`}
                    heads={directSection.heads}
                  />
                )}

                {/* ── GROSS PROFIT — the Trading Account's carry-forward,
                    sitting between Direct and Indirect Expenses. ── */}
                <TotalRow
                  label="Gross Profit / (Loss)"
                  formula="(Total Revenue − Direct Expenses)"
                  amount={statement.grossProfit}
                  priorAmount={prior?.grossProfit}
                  variant="subtotal"
                />

                {indirectSection && (
                  <SubRow
                    letter="b"
                    label={indirectSection.label ?? sectionLabel(indirectSection.key, entityClass)}
                    amount={indirectSection.total}
                    priorAmount={getPriorSection(indirectSection.key)?.total}
                    rowKey={`exp-${indirectSection.key}`}
                    heads={indirectSection.heads}
                  />
                )}
                {otherSections.map((s, i) => (
                  <SubRow
                    key={s.key}
                    letter={alpha(i + 3)}
                    label={s.label ?? sectionLabel(s.key, entityClass)}
                    amount={s.total}
                    priorAmount={getPriorSection(s.key)?.total}
                    rowKey={`exp-${s.key}`}
                    heads={s.heads}
                  />
                ))}
              </>
            );
          })()}
          <TotalRow
            label={`Total Expenses (${romanize(3)})`}
            amount={statement.totalExpenses}
            priorAmount={prior?.totalExpenses}
          />
          <DividerRow />

          {/* ── NET PROFIT / LOSS ──
              Gross Profit − Indirect Expenses (Tax Expense is folded into
              Indirect Expenses above — its own heads show in that row's
              drilldown — rather than a separate statutory Tax section). */}
          <TotalRow
            label="Net Profit / (Loss)"
            formula="(Gross Profit − Indirect Expenses)"
            amount={statement.netProfit}
            priorAmount={prior?.netProfit}
            double
            variant="grand"
          />

        </tbody>
      </table>

      {/* ── Notes to Accounts reference ── */}
      <div className="mt-4 pt-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
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
            <tr>
              <th className="pb-2.5 text-left pr-3">
                Expenditure (Dr.)
              </th>
              <th className="pb-2.5 text-right w-28">Amount ₹</th>
              <th className="w-6" />
              <th className="pb-2.5 text-left border-l border-border pl-4 pr-3">
                Income (Cr.)
              </th>
              <th className="pb-2.5 text-right w-28">Amount ₹</th>
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
                  <tr key={i} className="r-line align-top">
                    <td className="py-1.5 pr-3 text-[0.6875rem] text-foreground">{e ? `To ${e.groupName}` : ""}</td>
                    <td className="py-1.5 text-right font-heading text-[0.6875rem] tabular-nums text-foreground whitespace-nowrap">{e ? fmt(e.total) : ""}</td>
                    <td className="border-r border-border/30" />
                    <td className="py-1.5 pr-3 text-[0.6875rem] text-foreground border-l border-border/30 pl-4">{inc ? `By ${inc.groupName}` : ""}</td>
                    <td className="py-1.5 text-right font-heading text-[0.6875rem] tabular-nums text-foreground whitespace-nowrap">{inc ? fmt(inc.total) : ""}</td>
                  </tr>
                );
              })
            )}

            {/* Net Profit carried forward — balancing entry on Dr side */}
            {isProfit && (
              <tr className="r-sub-soft">
                <td className="py-1.5 pr-3 text-[0.6875rem] font-semibold text-foreground">
                  To Net Profit c/f
                </td>
                <td className="py-1.5 text-right font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground whitespace-nowrap">
                  {fmt(totals.netProfit)}
                </td>
                <td /><td className="border-l border-border/30" /><td />
              </tr>
            )}

            {/* Net Loss carried forward — balancing entry on Cr side */}
            {!isProfit && Math.abs(totals.netProfit) > 0.005 && (
              <tr className="r-sub-soft">
                <td /><td /><td />
                <td className="border-l border-border/30 pl-4 py-1.5 text-[0.6875rem] font-semibold text-destructive">
                  By Net Loss c/f
                </td>
                <td className="py-1.5 text-right font-heading text-[0.6875rem] font-semibold tabular-nums text-destructive whitespace-nowrap">
                  {fmt(Math.abs(totals.netProfit))}
                </td>
              </tr>
            )}

            {/* Grand total row — both sides must match */}
            <tr className="r-total">
              <td className="py-2 pr-3 text-xs font-bold text-foreground">Total</td>
              <td className="py-2 text-right font-heading text-xs font-bold tabular-nums text-foreground whitespace-nowrap">
                {fmt(Math.max(totals.income, totals.expenses))}
              </td>
              <td />
              <td className="border-l border-border/30 pl-4 py-2 text-xs font-bold text-foreground">Total</td>
              <td className="py-2 text-right font-heading text-xs font-bold tabular-nums text-foreground whitespace-nowrap">
                {fmt(Math.max(totals.income, totals.expenses))}
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
    <button onClick={onClick} aria-pressed={active} className={active ? "on" : undefined}>
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
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Profit and loss"
        subtitle={
          [periodLabel, data?.companyName || (companyId ? null : "All companies")].filter(Boolean).join(" · ") ||
          "What the business earned and spent over a period."
        }
        action={
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => setShowComparison((v) => !v)}
              aria-pressed={showComparison}
              className={`flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] border border-foreground transition-colors ${showComparison ? "bg-foreground text-card" : "text-foreground hover:bg-primary/10"}`}
            >
              Against prior year
            </button>
            <button onClick={fetchData} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] border border-foreground transition-colors text-foreground hover:bg-primary/10 disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >

        {/* ── Filters ── */}
        <div className="mb-5 bg-card px-4 py-4 space-y-4" style={{ border: "1px solid hsl(var(--foreground))" }}>

          {/* Period keys */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Period</span>
            <div className="seg flex-wrap">
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
          </div>

          {/* Date + Filters row */}
          <div className="flex flex-wrap items-end gap-3">

            <div className="flex flex-col gap-1">
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <CalendarDays size={9} /> From
              </span>
              <DateInput value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <CalendarDays size={9} /> To
              </span>
              <DateInput value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
              />
            </div>

            <div className="flex flex-col gap-1 min-w-[160px]">
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <Building size={9} /> Company
              </span>
              <select
                value={companyId ?? ""}
                onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
              >
                <option value="">All Companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1 min-w-[160px]">
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <FolderKanban size={9} /> Project
              </span>
              <select
                value={projectId ?? ""}
                onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
              >
                <option value="">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>

            {costCentres.length > 0 && (
              <div className="flex flex-col gap-1 min-w-[160px]">
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                  <Target size={9} /> Cost Centre
                </span>
                <select
                  value={costCentreId ?? ""}
                  onChange={(e) => setCostCentreId(e.target.value ? Number(e.target.value) : null)}
                  className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
                >
                  <option value="">All Cost Centres</option>
                  {costCentres.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}

            {rights.canExport && data && (
              <div className="ml-auto">
                <ExportMenu
                  title="Profit & Loss"
                  filename="profit-and-loss"
                  columns={exportColumns}
                  data={exportRows}
                  onPrint={() => window.print()}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Loading / Error ── */}
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={16} /> Loading statement…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 py-4 px-4 border border-destructive text-destructive text-sm">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* ── Main Content ── */}
        {!loading && !error && data && (() => {

          /* ── KPI Summary Bar (structured view only) ── */
          const showKpi = data.presentation === "structured" && st;

          return (
            <>
              {/* Figures */}
              {showKpi && st && (
                <div className="mb-5 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
                  <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                    {[
                      { label: "Revenue from operations", amount: st.revenueFromOperations.total, note: `plus ${fmt(st.otherIncome.total)} other income`, signed: false },
                      { label: st.grossProfit < -0.005 ? "Gross loss" : "Gross profit", amount: st.grossProfit, note: `margin ${pct(st.grossProfit, st.revenueFromOperations.total)}`, signed: true },
                      { label: "Indirect expenses", amount: st.indirectTotal, note: `including tax ${fmt(st.taxExpense.total)}`, signed: false },
                      { label: st.netProfit < -0.005 ? "Net loss" : "Net profit", amount: st.netProfit, note: `margin ${pct(st.netProfit, st.totalRevenue)}`, signed: true },
                    ].map((x) => {
                      // A loss is the one figure that turns red
                      const red = x.signed && x.amount < -0.005;
                      return (
                        <div key={x.label}>
                          <p className="label" style={red ? { color: "var(--red)" } : undefined}>{x.label}</p>
                          <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: red ? "var(--red)" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {red ? `(${fmt(x.amount)})` : fmt(x.amount)}
                          </p>
                          <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Against the prior year */}
                  {showComparison && priorLoading && (
                    <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
                      <Loader2 size={11} className="animate-spin" /> Loading prior year…
                    </div>
                  )}
                  {showComparison && !priorLoading && priorData && pst && (
                    <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-2" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
                      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Against prior year</span>
                      {[
                        { label: "Revenue", cur: st.totalRevenue, pri: pst.totalRevenue },
                        { label: "Gross profit", cur: st.grossProfit, pri: pst.grossProfit },
                        { label: "Net profit", cur: st.netProfit, pri: pst.netProfit },
                      ].map(({ label, cur, pri }) => {
                        const delta = cur - pri;
                        const isUp = delta >= 0;
                        return (
                          <span key={label} className="text-[0.75rem] text-muted-foreground">
                            {label}{" "}
                            <span className={`font-heading font-semibold tabular-nums ${isUp ? "text-foreground" : "text-destructive"}`}>
                              {isUp ? "▲" : "▼"} {fmt(Math.abs(delta))}
                            </span>
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
                <div className="mt-4 flex items-start gap-2 text-[0.6875rem] text-muted-foreground">
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

      </SheetShell>

      {/* ── Print styles ──
          #pl-printable sits many levels deep inside the app's layout tree
          (sidebar shell, content wrappers, ...), not as a direct child of
          <body> — a `body > *:not(#pl-printable) { display: none }` rule
          only ever matches body's immediate children, so it hid the app's
          root wrapper (not #pl-printable itself) and took the printable
          content down with it, printing a blank page. `visibility: hidden`
          on everything, then `visibility: visible` back on just the target
          and its descendants, works regardless of nesting depth. ── */}
      <style>{`
        #pl-printable tbody tr { border: 0 !important; background: transparent !important; }
        #pl-printable tbody tr.r-line { border-bottom: 1px solid hsl(var(--border) / 0.7) !important; }
        #pl-printable tbody tr.r-click:hover { background: var(--blue-wash) !important; }
        #pl-printable tbody tr.r-sub { border-top: 1px solid hsl(var(--foreground)) !important; }
        #pl-printable tbody tr.r-sub-soft { border-top: 1px solid hsl(var(--border)) !important; }
        #pl-printable tbody tr.r-total { border-top: 2px solid hsl(var(--foreground)) !important; border-bottom: 1px solid hsl(var(--foreground)) !important; }
        @media print {
          #pl-printable tbody tr[class] { border-color: #000 !important; }
          body * { visibility: hidden !important; }
          #pl-printable, #pl-printable * { visibility: visible !important; }
          /* The dark theme's --foreground/--muted-foreground resolve to
             near-white text, which nothing here forces back to a readable
             color for print — every amount was rendering white-on-white,
             invisible on paper. Negative amounts already use "(...)"
             parentheses (standard accounting convention), so plain black
             throughout is both safe and correct here, not just a fallback. */
          #pl-printable, #pl-printable * {
            color: #000 !important;
            background-color: transparent !important;
            border-color: #999 !important;
          }
          #pl-printable {
            /* fixed (not absolute) so it anchors to the page itself instead
               of whatever relatively-positioned ancestor it happens to sit
               inside — absolute was positioning/sizing it relative to that
               ancestor's box, not the physical page, which is why it landed
               off-center with the wrong width instead of flush top-left. */
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </>
  );
}
