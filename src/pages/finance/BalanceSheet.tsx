import { Fragment, useEffect, useState, useCallback, type ReactNode } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
  Printer,
  Info,
  Minus,
  AlertCircle,
} from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Option { id: number; label: string; }

interface Head {
  id: number | null;
  name: string;
  amount: number;
}

interface StatementGroup {
  groupId: number | string;
  groupName: string;
  heads: Head[];
  total: number;
}

interface PartnerRollForward {
  key: string;
  name: string;
  opening: number;
  capitalIntroduced: number;
  credits: number;
  drawings: number;
  closing: number;
}

interface PartnersCapital {
  openingCapital: number;
  furtherCapital: number;
  netProfitCurrent: number;
  drawings: number;
  total: number;
  capitalHeads: Head[];
  partners: PartnerRollForward[];
}

interface ReservesAndSurplus {
  retainedEarningsPrior: number;
  total: number;
}

interface Ratios {
  currentRatio:            number | null;
  quickRatio:              number | null;
  workingCapital:          number;
  debtToEquity:            number | null;
  totalCurrentAssets:      number;
  totalNonCurrentAssets:   number;
  totalCurrentLiabilities: number;
  totalNonCurrentLiabilities: number;
  totalEquity:             number;
}

interface BalanceSheetResponse {
  asOf:         string;
  companyName:  string | null;
  entityType:   string | null;
  partnersCapital: PartnersCapital;
  reservesAndSurplus: ReservesAndSurplus;
  partnersDrawings: StatementGroup[];
  provisionsReserves: StatementGroup[];
  fixedLiabilities: StatementGroup[];
  // Includes an "Advance from Customers" group for any Sundry Debtors head
  // with a credit balance — an advance, not a debtor — reclassified here
  // instead of appearing as a negative figure under Sundry Debtors on the
  // Assets side.
  currentLiabilities: StatementGroup[];
  fixedAssets: { tangible: StatementGroup[]; intangible: StatementGroup[] };
  investments: StatementGroup[];
  currentAssets: StatementGroup[];
  fictitiousAssets: StatementGroup[];
  totals:       { liabilities: number; assets: number; difference: number };
  balanced:     boolean;
  netProfit:    number;
  ratios:       Ratios | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => formatINR(Math.abs(n));
const r2  = (n: number | null) => n == null ? "—" : n.toFixed(2);

function Signed({ amount, className = "" }: { amount: number; className?: string }) {
  const neg = amount < -0.005;
  return (
    <span className={`tabular-nums ${neg ? "text-destructive" : ""} ${className}`}>
      {neg ? "(" : ""}{fmt(amount)}{neg ? ")" : ""}
    </span>
  );
}

// ─── Ratio Health Indicator ───────────────────────────────────────────────────

function ratioHealth(key: string, value: number | null): "good" | "warn" | "bad" | "neutral" {
  if (value == null) return "neutral";
  switch (key) {
    case "currentRatio": return value >= 2 ? "good" : value >= 1 ? "warn" : "bad";
    case "quickRatio":   return value >= 1 ? "good" : value >= 0.5 ? "warn" : "bad";
    case "debtToEquity": return value <= 1 ? "good" : value <= 2 ? "warn" : "bad";
    case "workingCapital": return value > 0 ? "good" : "bad";
    default: return "neutral";
  }
}

const HEALTH_MARK: Record<"good" | "warn" | "bad", { text: string; tone: "done" | "waiting" | "stopped" }> = {
  good: { text: "Healthy", tone: "done" },
  warn: { text: "Watch", tone: "waiting" },
  bad:  { text: "Attention", tone: "stopped" },
};

// ─── Ratio ────────────────────────────────────────────────────────────────────

function Ratio({
  label, value, formatted, healthKey, subtitle, benchmark,
}: {
  label:      string;
  value:      number | null;
  formatted:  string;
  healthKey:  string;
  subtitle?:  string;
  benchmark?: string;
}) {
  const health = ratioHealth(healthKey, value);
  return (
    <div>
      <p className="label">{label}</p>
      <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: health === "bad" ? "var(--red)" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {formatted}
      </p>
      {subtitle && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{subtitle}</p>}
      <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 8 }}>
        {health !== "neutral" && <SheetMark text={HEALTH_MARK[health].text} tone={HEALTH_MARK[health].tone} />}
        {benchmark && <span style={{ fontSize: 11, color: "var(--graphite)" }}>{benchmark}</span>}
      </div>
    </div>
  );
}

// ─── Statement Sheet Chrome ───────────────────────────────────────────────────

function StatementSheet({
  companyName, asOfLabel, children,
}: {
  companyName: string | null;
  asOfLabel:   string;
  children:    ReactNode;
}) {
  return (
    <div id="bs-printable" className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
      {/* Letterhead */}
      <div className="px-6 pt-5 pb-4 text-center" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
        <h2 className="font-heading text-sm font-bold tracking-[0.1em] text-foreground uppercase">
          {companyName || "Consolidated: all companies"}
        </h2>
        <h3 className="font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground mt-2">Balance Sheet</h3>
        <p className="text-[0.75rem] text-muted-foreground mt-1 tabular-nums">{asOfLabel}</p>
        <p className="text-[0.625rem] text-muted-foreground mt-1">
          (All amounts in Indian Rupees ₹, unless otherwise stated)
        </p>
      </div>
      <div className="px-5 py-4 overflow-x-auto">{children}</div>
    </div>
  );
}

// ─── Section Header Row ───────────────────────────────────────────────────────

function SectionHeader({ roman, label }: { roman: string; label: string }) {
  return (
    <tr className="r-head">
      <td colSpan={4} className="py-2.5 px-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground">{roman}.</span>
          <span className="font-heading text-xs font-bold text-foreground uppercase tracking-[0.14em]">{label}</span>
        </div>
      </td>
    </tr>
  );
}

// A running counter shared across the whole statement so every group gets a
// stable, sequential footnote number ("Note No.") — same convention as the
// printed Schedule III-style format, one counter threaded through every
// section in the order they're rendered, not reset per-section.
type NoteRef = { current: number };

// ─── Group Row (collapsible) ──────────────────────────────────────────────────

function GroupRow({
  group, openKey, onToggle, indent = 8, showNote, noteNum,
}: {
  group:     StatementGroup;
  openKey:   string | null;
  onToggle:  (k: string) => void;
  indent?:   number;
  showNote?: boolean;
  noteNum?:  number;
}) {
  const key       = `g-${group.groupId}`;
  const isOpen    = openKey === key;
  const clickable = group.heads.length > 0;

  return (
    <>
      <tr
        className={`r-line ${clickable ? "r-click cursor-pointer" : ""}`}
        onClick={() => clickable && onToggle(key)}
      >
        <td className="py-2 pr-3 text-[0.6875rem] text-foreground" style={{ paddingLeft: indent * 4 }}>
          <div className="flex items-center gap-2">
            {clickable ? (
              isOpen
                ? <ChevronDown size={11} className="text-foreground shrink-0" />
                : <ChevronRight size={11} className="text-foreground shrink-0" />
            ) : <span className="w-[10px] shrink-0" />}
            <span className={clickable ? "font-medium" : ""}>{group.groupName}</span>
          </div>
        </td>
        {/* Note ref */}
        <td className="py-2 px-3 text-right font-heading text-[0.625rem] tabular-nums text-muted-foreground w-16">
          {showNote && noteNum ? noteNum : ""}
        </td>
        {/* Sub-amount (heads sum) — only shown when there's more than one head to sum */}
        <td className="py-2 px-3 text-right font-heading text-[0.6875rem] tabular-nums text-muted-foreground w-32">
          {group.heads.length > 1 ? fmt(group.total) : ""}
        </td>
        <td className="py-2 pl-3 pr-5 text-right font-heading text-[0.6875rem] tabular-nums font-semibold text-foreground w-36">
          {fmt(group.total)}
        </td>
      </tr>

      {isOpen && group.heads.length > 0 && (
        <tr>
          <td colSpan={4} className="pb-1.5">
            <div className="ml-4 mr-5 pl-3 py-1 space-y-1" style={{ marginLeft: indent * 4 + 8, borderLeft: "1px solid hsl(var(--foreground))" }}>
              {group.heads.map((h) => (
                <div key={h.id ?? h.name} className="flex items-center justify-between text-[0.6875rem] text-muted-foreground group">
                  <span className="truncate pr-4 group-hover:text-foreground transition-colors">{h.name}</span>
                  <Signed amount={h.amount} className="shrink-0 font-heading font-medium text-foreground" />
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Group list (with "no entries" fallback) ─────────────────────────────────

function GroupList({
  groups, openKey, onToggle, emptyLabel, noteRef,
}: {
  groups: StatementGroup[];
  openKey: string | null;
  onToggle: (k: string) => void;
  emptyLabel: string;
  noteRef: NoteRef;
}) {
  if (groups.length === 0) {
    return <tr><td colSpan={4} className="py-1.5 pl-8 text-[0.625rem] text-muted-foreground italic">— {emptyLabel} —</td></tr>;
  }
  return (
    <>
      {groups.map((g) => (
        <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={onToggle}
          showNote noteNum={noteRef.current++} />
      ))}
    </>
  );
}

// ─── Section subtotal + wrapper ──────────────────────────────────────────────

function SectionBlock({ label, amount, children }: { label: string; amount: number; children: ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-2.5 pb-0.5 pl-5">
          <span className="font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.1em]">{label}</span>
        </td>
      </tr>
      {children}
      <tr className="r-sub">
        <td colSpan={3} className="py-1.5 pl-8 pr-3 text-[0.6875rem] font-semibold text-foreground">Sub-total: {label}</td>
        <td className="py-1.5 pl-3 pr-5 text-right font-heading text-xs font-semibold tabular-nums text-foreground w-36">{fmt(amount)}</td>
      </tr>
      <tr><td colSpan={4} className="py-1.5" /></tr>
    </>
  );
}

// ─── Grand Total Row ──────────────────────────────────────────────────────────

function GrandTotalRow({ label, amount }: { label: string; amount: number }) {
  // Closed off the way a statement is: a heavy rule above the total, a rule beneath
  return (
    <tr className="r-total">
      <td colSpan={3} className="py-2.5 pl-5 pr-3 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-foreground">{label}</td>
      <td className="py-2.5 pl-3 pr-5 text-right font-heading text-[0.8125rem] font-bold tabular-nums w-36 text-foreground">
        {fmt(amount)}
      </td>
    </tr>
  );
}

// ─── Partners' Capital block ──────────────────────────────────────────────────
// Rendered on its own (not via SectionBlock/GroupRow) since it's a
// roll-forward, not a flat group list: Opening + Further Capital + Net
// Profit − Drawings = Partners' Capital. Retained Earnings b/f (prior
// years' net P&L) is NOT a partner capital contribution, so it's reported
// separately under Reserves & Surplus instead — see ReservesAndSurplusBlock
// below. Drawings expands to the partner-wise drill-down (Cash Withdrawal,
// Interest on Drawings, ...) per partner; the individual capital ledger
// heads (one per partner's Capital A/c) expand separately.

function PartnersCapitalBlock({
  data,
}: {
  data: PartnersCapital;
  openKey: string | null;
  onToggle: (k: string) => void;
  noteRef: NoteRef;
}) {
  // One block per partner, laid out like a firm's printed partners' capital
  // schedule: Balance as per last account + Capital introduced + Share of
  // profit / remuneration / interest (credited to the Current A/c) −
  // Drawings = closing. The period's Net Profit sits below as its own line
  // until it's allocated to partners (no profit-sharing ratio is stored).
  // Only worth a line once something has actually been credited to a
  // partner's Current A/c (profit share, remuneration, interest) — when the
  // only entries are drawings, an always-zero line is just noise.
  const showCredits = data.partners.some((p) => Math.abs(p.credits) > 0.005);
  const row = (label: string, amount: number, opts: { sub?: boolean; strong?: boolean; neg?: boolean } = {}) => (
    <tr className={opts.sub ? "r-sub-soft" : "r-line"}>
      <td className={`py-1 pl-10 pr-3 text-[0.6875rem] ${opts.strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</td>
      <td className="w-16" />
      <td className="py-1 px-3 text-right font-heading text-[0.6875rem] tabular-nums text-muted-foreground w-32">
        {!opts.strong && (opts.neg ? `(${fmt(amount)})` : <Signed amount={amount} />)}
      </td>
      <td className="py-1 pl-3 pr-5 text-right font-heading text-[0.6875rem] tabular-nums w-36">
        {opts.strong && <span className="font-semibold"><Signed amount={amount} /></span>}
      </td>
    </tr>
  );

  return (
    <>
      <tr>
        <td colSpan={4} className="pt-2.5 pb-0.5 pl-5">
          <span className="font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.1em]">Partners' Capital Account</span>
        </td>
      </tr>

      {data.partners.length === 0 && (
        <tr><td colSpan={4} className="py-1.5 pl-8 text-[0.6875rem] italic text-muted-foreground">No partner capital recorded</td></tr>
      )}

      {data.partners.map((p) => {
        const before = p.opening + p.capitalIntroduced + p.credits;
        return (
          <Fragment key={p.key}>
            <tr>
              <td colSpan={4} className="pt-2 pb-0.5 pl-8">
                <span className="text-[0.6875rem] font-semibold underline underline-offset-2 text-foreground">{p.name} :</span>
              </td>
            </tr>
            {row("Balance as per last account", p.opening)}
            {row("Add: Capital introduced", p.capitalIntroduced)}
            {showCredits && row("Add: Share of Profit / Remuneration / Interest", p.credits)}
            {row("Sub-total", before, { sub: true })}
            {row("Less: Drawings", p.drawings, { neg: true })}
            {row(`Closing balance: ${p.name}`, p.closing, { sub: true, strong: true })}
          </Fragment>
        );
      })}

      <tr className="r-sub-soft">
        <td className="py-1.5 pl-8 pr-3 text-[0.6875rem] text-muted-foreground">
          Add: Net Profit / (Loss) for the period <span className="opacity-60">(not yet allocated to partners)</span>
        </td>
        <td className="w-16" />
        <td className="w-32" />
        <td className="py-1.5 pl-3 pr-5 text-right font-heading text-[0.6875rem] tabular-nums font-medium w-36"><Signed amount={data.netProfitCurrent} /></td>
      </tr>

      <tr className="r-sub">
        <td colSpan={3} className="py-1.5 pl-8 pr-3 text-[0.6875rem] font-semibold text-foreground">Sub-total: Partners' Capital Account</td>
        <td className="py-1.5 pl-3 pr-5 text-right font-heading text-xs font-semibold tabular-nums text-foreground w-36"><Signed amount={data.total} /></td>
      </tr>
      <tr><td colSpan={4} className="py-1.5" /></tr>
    </>
  );
}

// ─── Reserves & Surplus block ─────────────────────────────────────────────────
// Retained Earnings b/f (prior years' net P&L) used to sit inside Partners'
// Capital's roll-forward — moved out since it's the result of invoices and
// payments posted in earlier financial years, not a partner capital
// contribution. Same single-line-plus-subtotal shape as Partners' Capital's
// roll-forward rows, just its own section.
function ReservesAndSurplusBlock({ data }: { data: ReservesAndSurplus }) {
  if (Math.abs(data.total) < 0.005) return null;
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-2.5 pb-0.5 pl-5">
          <span className="font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.1em]">Reserves &amp; Surplus</span>
        </td>
      </tr>
      <tr className="r-line">
        <td className="py-1.5 pl-8 pr-3 text-[0.6875rem] text-muted-foreground">Retained Earnings b/f (Prior Years)</td>
        <td className="w-16" />
        <td className="w-32" />
        <td className="py-1.5 pl-3 pr-5 text-right font-heading text-[0.6875rem] tabular-nums font-medium w-36"><Signed amount={data.retainedEarningsPrior} /></td>
      </tr>
      <tr className="r-sub">
        <td colSpan={3} className="py-1.5 pl-8 pr-3 text-[0.6875rem] font-semibold text-foreground">Sub-total: Reserves &amp; Surplus</td>
        <td className="py-1.5 pl-3 pr-5 text-right font-heading text-xs font-semibold tabular-nums text-foreground w-36">{fmt(data.total)}</td>
      </tr>
      <tr><td colSpan={4} className="py-1.5" /></tr>
    </>
  );
}

// ─── Vertical Statement ───────────────────────────────────────────────────────

function VerticalStatement({
  data, asOfLabel,
}: {
  data:      BalanceSheetResponse;
  asOfLabel: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));

  // Fresh each render (deterministic given the same data) — one counter
  // shared across every section so note numbers run continuously down the
  // statement, matching the printed Schedule III-style "Note No." column.
  const noteRef: NoteRef = { current: 1 };

  const totalProvisionsReserves = data.provisionsReserves.reduce((s, g) => s + g.total, 0);
  const totalFixedLiabilities = data.fixedLiabilities.reduce((s, g) => s + g.total, 0);
  const totalCurrentLiabilities = data.currentLiabilities.reduce((s, g) => s + g.total, 0);
  const totalFixedAssetsTangible = data.fixedAssets.tangible.reduce((s, g) => s + g.total, 0);
  const totalFixedAssetsIntangible = data.fixedAssets.intangible.reduce((s, g) => s + g.total, 0);
  const totalFixedAssets = totalFixedAssetsTangible + totalFixedAssetsIntangible;
  const totalInvestments = data.investments.reduce((s, g) => s + g.total, 0);
  const totalCurrentAssets = data.currentAssets.reduce((s, g) => s + g.total, 0);
  const totalFictitiousAssets = data.fictitiousAssets.reduce((s, g) => s + g.total, 0);

  return (
    <StatementSheet companyName={data.companyName} asOfLabel={asOfLabel}>
      <table className="w-full border-collapse min-w-[560px]">
        <thead>
          <tr>
            <th className="pb-2.5 pl-5 text-left">
              Particulars
            </th>
            <th className="pb-2.5 px-3 text-right w-16">
              Note No.
            </th>
            <th className="pb-2.5 px-3 text-right w-32">
              Sub-Total ₹
            </th>
            <th className="pb-2.5 pl-3 pr-5 text-right w-36">
              Amount ₹
            </th>
          </tr>
        </thead>
        <tbody>

          {/* ═══════════════ LIABILITIES ═══════════════ */}
          <SectionHeader roman="I" label="Liabilities" />

          <PartnersCapitalBlock data={data.partnersCapital} openKey={openKey} onToggle={toggle} noteRef={noteRef} />

          <ReservesAndSurplusBlock data={data.reservesAndSurplus} />

          <SectionBlock label="Provisions & Reserves" amount={totalProvisionsReserves}>
            <GroupList groups={data.provisionsReserves} openKey={openKey} onToggle={toggle} emptyLabel="No provisions or reserves" noteRef={noteRef} />
          </SectionBlock>

          <SectionBlock label="Fixed Liabilities" amount={totalFixedLiabilities}>
            <GroupList groups={data.fixedLiabilities} openKey={openKey} onToggle={toggle} emptyLabel="No fixed liabilities" noteRef={noteRef} />
          </SectionBlock>

          {/* Includes an "Advance from Customers" group for any Sundry
              Debtors head with a credit balance — customers who've paid
              more than they currently owe — instead of showing as a
              negative figure under Sundry Debtors on the Assets side. */}
          <SectionBlock label="Current Liabilities" amount={totalCurrentLiabilities}>
            <GroupList groups={data.currentLiabilities} openKey={openKey} onToggle={toggle} emptyLabel="No current liabilities" noteRef={noteRef} />
          </SectionBlock>

          <GrandTotalRow label="Total liabilities" amount={data.totals.liabilities} />

          {/* ═══════════════ ASSETS ═══════════════ */}
          <tr><td colSpan={4} className="pt-4" /></tr>
          <SectionHeader roman="II" label="Assets" />

          <tr>
            <td colSpan={4} className="pt-2.5 pb-0.5 pl-5">
              <span className="font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.1em]">Fixed Assets</span>
            </td>
          </tr>
          <tr>
            <td colSpan={4} className="pt-1 pb-0.5 pl-7">
              <span className="text-[0.625rem] font-semibold text-foreground/70">Tangible Assets</span>
            </td>
          </tr>
          <GroupList groups={data.fixedAssets.tangible} openKey={openKey} onToggle={toggle} emptyLabel="No tangible assets" noteRef={noteRef} />
          <tr>
            <td colSpan={4} className="pt-1.5 pb-0.5 pl-7">
              <span className="text-[0.625rem] font-semibold text-foreground/70">Intangible Assets</span>
            </td>
          </tr>
          <GroupList groups={data.fixedAssets.intangible} openKey={openKey} onToggle={toggle} emptyLabel="No intangible assets" noteRef={noteRef} />
          <tr className="r-sub">
            <td colSpan={3} className="py-1.5 pl-8 pr-3 text-[0.6875rem] font-semibold text-foreground">Sub-total: Fixed Assets</td>
            <td className="py-1.5 pl-3 pr-5 text-right font-heading text-xs font-semibold tabular-nums text-foreground w-36">{fmt(totalFixedAssets)}</td>
          </tr>
          <tr><td colSpan={4} className="py-1.5" /></tr>

          <SectionBlock label="Investments" amount={totalInvestments}>
            <GroupList groups={data.investments} openKey={openKey} onToggle={toggle} emptyLabel="No investments" noteRef={noteRef} />
          </SectionBlock>

          <SectionBlock label="Current Assets" amount={totalCurrentAssets}>
            <GroupList groups={data.currentAssets} openKey={openKey} onToggle={toggle} emptyLabel="No current assets" noteRef={noteRef} />
          </SectionBlock>

          <SectionBlock label="Fictitious Assets / Deferred Revenue Expenditure" amount={totalFictitiousAssets}>
            <GroupList groups={data.fictitiousAssets} openKey={openKey} onToggle={toggle} emptyLabel="No fictitious assets" noteRef={noteRef} />
          </SectionBlock>

          <GrandTotalRow label="Total assets" amount={data.totals.assets} />

        </tbody>
      </table>

      {/* Balance check */}
      <div className="mt-4 pt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
        <SheetMark
          text={data.balanced ? "Balanced: total liabilities equal total assets" : "Out of balance: check for unposted entries"}
          tone={data.balanced ? "done" : "stopped"}
        />
        <span className="font-heading text-[0.6875rem] tabular-nums text-foreground">
          Assets {fmt(data.totals.assets)} · Liabilities {fmt(data.totals.liabilities)}
          {!data.balanced && <span className="text-destructive font-semibold"> · Difference {fmt(data.totals.difference)}</span>}
        </span>
      </div>

      {/* Note */}
      <div className="mt-3 pt-2.5" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
          Prepared per the classic vertical Balance Sheet format for partnership/proprietorship entities. Every figure is pulled live
          from the account groups tagged in Account Group Master; click any row (›) to view the underlying ledger heads.
          Net Profit is pulled from the current Profit &amp; Loss statement; Partners' Drawings are deducted from Partners' Capital.
        </p>
      </div>
    </StatementSheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BalanceSheet() {
  const rights = usePageRights("balance-sheet");

  const [asOf,      setAsOf]      = useState(() => new Date().toISOString().slice(0, 10));
  const [companies, setCompanies] = useState<Option[]>([]);
  const [projects,  setProjects]  = useState<Option[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);

  const [data,    setData]    = useState<BalanceSheetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Load dropdowns
  useEffect(() => {
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json()).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ asOf });
    if (companyId) qs.set("companyId", String(companyId));
    if (projectId) qs.set("projectId", String(projectId));
    fetchWithAuth(`/api/financial-statements/balance-sheet?${qs.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setData(d))
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [asOf, companyId, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Quick date shortcuts
  const setFYEnd = () => {
    const now = new Date();
    const fy  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    setAsOf(`${fy + 1}-03-31`);
  };
  const setToday = () => setAsOf(new Date().toISOString().slice(0, 10));
  const setFYMid = () => {
    const now = new Date();
    const fy  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    setAsOf(`${fy}-09-30`);
  };

  // Export
  const exportColumns: ExportColumn[] = [
    { header: "Side",  accessor: "side" },
    { header: "Group", accessor: "group" },
    { header: "Head",  accessor: "head" },
    { header: "Amount", accessor: "amount" },
  ];
  const exportRows = data
    ? [
        { side: "Liabilities", group: "Partners' Capital", head: "Opening Capital", amount: data.partnersCapital.openingCapital },
        { side: "Liabilities", group: "Reserves & Surplus", head: "Retained Earnings b/f", amount: data.reservesAndSurplus.retainedEarningsPrior },
        { side: "Liabilities", group: "Partners' Capital", head: "Further Capital", amount: data.partnersCapital.furtherCapital },
        { side: "Liabilities", group: "Partners' Capital", head: "Net Profit (Current Period)", amount: data.partnersCapital.netProfitCurrent },
        { side: "Liabilities", group: "Partners' Capital", head: "Partners' Drawings", amount: -data.partnersCapital.drawings },
        ...data.provisionsReserves.flatMap((g) => g.heads.map((h) => ({ side: "Liabilities", group: "Provisions & Reserves", head: h.name, amount: h.amount }))),
        ...data.fixedLiabilities.flatMap((g) => g.heads.map((h) => ({ side: "Liabilities", group: "Fixed Liabilities", head: h.name, amount: h.amount }))),
        ...data.currentLiabilities.flatMap((g) => g.heads.map((h) => ({ side: "Liabilities", group: "Current Liabilities", head: h.name, amount: h.amount }))),
        ...data.fixedAssets.tangible.flatMap((g) => g.heads.map((h) => ({ side: "Assets", group: "Fixed Assets — Tangible", head: h.name, amount: h.amount }))),
        ...data.fixedAssets.intangible.flatMap((g) => g.heads.map((h) => ({ side: "Assets", group: "Fixed Assets — Intangible", head: h.name, amount: h.amount }))),
        ...data.investments.flatMap((g) => g.heads.map((h) => ({ side: "Assets", group: "Investments", head: h.name, amount: h.amount }))),
        ...data.currentAssets.flatMap((g) => g.heads.map((h) => ({ side: "Assets", group: "Current Assets", head: h.name, amount: h.amount }))),
        ...data.fictitiousAssets.flatMap((g) => g.heads.map((h) => ({ side: "Assets", group: "Fictitious Assets", head: h.name, amount: h.amount }))),
      ]
    : [];

  const asOfLabel = data
    ? `As at ${new Date(data.asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`
    : "";

  const ratios = data?.ratios ?? null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Balance Sheet"]} />
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Balance sheet"
        subtitle={
          [asOfLabel, data?.companyName || (companyId ? null : "All companies")].filter(Boolean).join(" · ") ||
          "What the business owns and owes on a given date."
        }
        action={
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors"
            >
              <Printer size={13} /> <span className="hidden sm:inline">Print</span>
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >

        {/* ── Filters ── */}
        <div className="mb-5 bg-card px-4 py-4 flex flex-wrap items-end gap-x-4 gap-y-3" style={{ border: "1px solid hsl(var(--foreground))" }}>
          <div className="flex flex-col gap-1">
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><CalendarDays size={9} /> As at</span>
            <DateInput value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="h-9 px-2.5 text-xs bg-card border border-foreground text-foreground font-semibold focus:outline-none"
            />
          </div>

          <div className="seg" style={{ height: 36 }}>
            {[
              { label: "Today",          fn: setToday, on: asOf === new Date().toISOString().slice(0, 10) },
              { label: "Half-year end",  fn: setFYMid, on: asOf.endsWith("-09-30") },
              { label: "Year end",       fn: setFYEnd, on: asOf.endsWith("-03-31") },
            ].map(({ label, fn, on }) => (
              <button key={label} onClick={fn} aria-pressed={on} className={on ? "on" : undefined}>{label}</button>
            ))}
          </div>

          <div className="flex flex-col gap-1 min-w-[160px]">
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><Building size={9} /> Company</span>
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
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1"><FolderKanban size={9} /> Project</span>
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              className="h-9 px-2.5 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground"
            >
              <option value="">All Projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          {rights.canExport && data && (
            <div className="ml-auto">
              <ExportMenu title="Balance Sheet" filename="balance-sheet" columns={exportColumns} data={exportRows} />
            </div>
          )}
        </div>

        {/* ── Loading ── */}
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={16} /> Loading balance sheet…
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 py-4 px-4 border border-destructive text-destructive text-sm">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* ── Main Content ── */}
        {!loading && !error && data && (() => {
          const r = ratios;

          return (
            <>
              {/* ── Figures ── */}
              <div className="mb-5 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
                <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                  {[
                    {
                      label: "Total assets",
                      value: fmt(data.totals.assets),
                      note: r ? `Current ${fmt(r.totalCurrentAssets)} · Non-current ${fmt(r.totalNonCurrentAssets)}` : null,
                      red: false,
                    },
                    {
                      label: "Total liabilities",
                      value: fmt(data.totals.liabilities),
                      note: r ? `Partners' capital ${fmt(r.totalEquity)} · Other ${fmt(r.totalCurrentLiabilities + r.totalNonCurrentLiabilities)}` : null,
                      red: false,
                    },
                    {
                      label: data.balanced ? "Difference" : "Out of balance by",
                      value: fmt(data.totals.difference),
                      note: data.balanced ? "liabilities equal assets" : "liabilities and assets do not agree",
                      red: !data.balanced,
                    },
                    {
                      label: data.netProfit < -0.005 ? "Loss for the period" : "Profit for the period",
                      value: data.netProfit < -0.005 ? `(${fmt(data.netProfit)})` : fmt(data.netProfit),
                      note: "carried into partners' capital",
                      red: data.netProfit < -0.005,
                    },
                  ].map((x) => (
                    <div key={x.label}>
                      <p className="label" style={x.red ? { color: "var(--red)" } : undefined}>{x.label}</p>
                      <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {x.value}
                      </p>
                      {x.note && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>}
                    </div>
                  ))}
                </div>

                {/* ── Ratios ── */}
                {r && (
                  <div className="statrow four" style={{ padding: "16px 16px 18px", borderTop: "1px solid hsl(var(--foreground))" }}>
                    <Ratio
                      label="Current ratio"
                      value={r.currentRatio}
                      formatted={r2(r.currentRatio)}
                      healthKey="currentRatio"
                      subtitle="Current assets / current liabilities"
                      benchmark="Ideal ≥ 2.0"
                    />
                    <Ratio
                      label="Quick ratio"
                      value={r.quickRatio}
                      formatted={r2(r.quickRatio)}
                      healthKey="quickRatio"
                      subtitle="(Current assets − stock) / current liabilities"
                      benchmark="Ideal ≥ 1.0"
                    />
                    <Ratio
                      label="Working capital"
                      value={r.workingCapital}
                      formatted={r.workingCapital < -0.005 ? `(${fmt(r.workingCapital)})` : fmt(r.workingCapital)}
                      healthKey="workingCapital"
                      subtitle="Current assets − current liabilities"
                    />
                    <Ratio
                      label="Debt / capital"
                      value={r.debtToEquity}
                      formatted={r2(r.debtToEquity)}
                      healthKey="debtToEquity"
                      subtitle="Total liabilities / partners' capital"
                      benchmark="Ideal ≤ 1.0"
                    />
                  </div>
                )}
              </div>

              {/* ── Refresh overlay ── */}
              {loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Loader2 size={11} className="animate-spin" /> Refreshing…
                </div>
              )}

              {/* ── Vertical Statement ── */}
              <VerticalStatement data={data} asOfLabel={asOfLabel} />

              {/* ── Info ── */}
              <div className="mt-4 flex items-start gap-2 text-[0.6875rem] text-muted-foreground">
                <Info size={11} className="shrink-0 mt-0.5" />
                <span>
                  Section classification is heuristic-based on Account Group names — set up Partners Drawings / Fictitious Assets
                  account heads in Account Group Master to have them flow in here automatically.
                </span>
              </div>
            </>
          );
        })()}

        {/* ── Empty state ── */}
        {!loading && !error && !data && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Minus size={32} className="opacity-30" />
            <p className="text-sm">Select a date and click Refresh to load the balance sheet.</p>
          </div>
        )}

      </SheetShell>

      {/* Print styles — #bs-printable is nested deep inside the page shell's
          layout chrome, not a direct child of body, so a `body > *` selector
          can't isolate it: none of body's actual direct children match
          #bs-printable, so they'd all get hidden — including the ancestor
          that #bs-printable itself lives inside, taking it down too (a
          blank print preview). visibility (inherited, but overridable per
          element) sidesteps that: hide everything, then explicitly make
          #bs-printable and its descendants visible again regardless of how
          deep they're nested. */}
      <style>{`
        #bs-printable tbody tr { border: 0 !important; background: transparent !important; }
        #bs-printable tbody tr.r-line { border-bottom: 1px solid hsl(var(--border) / 0.7) !important; }
        #bs-printable tbody tr.r-click:hover { background: var(--blue-wash) !important; }
        #bs-printable tbody tr.r-sub { border-top: 1px solid hsl(var(--foreground)) !important; }
        #bs-printable tbody tr.r-sub-soft { border-top: 1px solid hsl(var(--border)) !important; }
        #bs-printable tbody tr.r-head { border-top: 1px solid hsl(var(--foreground)) !important; border-bottom: 1px solid hsl(var(--foreground)) !important; }
        #bs-printable tbody tr.r-total { border-top: 2px solid hsl(var(--foreground)) !important; border-bottom: 1px solid hsl(var(--foreground)) !important; }
        @media print {
          #bs-printable tbody tr[class] { border-color: #000 !important; }
          body * { visibility: hidden !important; }
          #bs-printable, #bs-printable * { visibility: visible !important; }
          /* The dark theme's --foreground/--muted-foreground resolve to
             near-white text, which nothing here forces back to a readable
             color for print — amounts would render white-on-white, invisible
             on paper. Same fix already applied on ProfitAndLoss.tsx's
             #pl-printable. */
          #bs-printable, #bs-printable * {
            color: #000 !important;
            background-color: transparent !important;
            border-color: #999 !important;
          }
          #bs-printable {
            /* fixed (not absolute) so it anchors to the page itself instead
               of whatever relatively-positioned ancestor it happens to sit
               inside — absolute was positioning it relative to that
               ancestor's box (somewhere down the page, past the app's
               navbar/sidebar/toolbar chrome), which is why the printed page
               opened with a large blank void before the content instead of
               starting flush at the top. Same fix already applied on
               ProfitAndLoss.tsx's #pl-printable. */
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>
    </>
  );
}
