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
  Scale,
  Loader2,
  ChevronDown,
  ChevronRight,
  Printer,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Banknote,
  ShieldCheck,
  Activity,
  Info,
  Minus,
  AlertCircle,
  Target,
} from "lucide-react";

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

interface PartnersCapital {
  openingCapital: number;
  retainedEarningsPrior: number;
  furtherCapital: number;
  netProfitCurrent: number;
  drawings: number;
  total: number;
  capitalHeads: Head[];
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
  partnersDrawings: StatementGroup[];
  provisionsReserves: StatementGroup[];
  fixedLiabilities: StatementGroup[];
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
    <span className={`tabular-nums ${neg ? "text-red-600 dark:text-red-400" : ""} ${className}`}>
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

const healthColors = {
  good:    "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  warn:    "text-amber-600  dark:text-amber-400  bg-amber-500/10  border-amber-500/25",
  bad:     "text-red-600    dark:text-red-400    bg-red-500/10    border-red-500/25",
  neutral: "text-foreground                      bg-muted/40      border-border",
};

const healthIconColors = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  bad:  "text-red-500",
  neutral: "text-muted-foreground",
};

// ─── Ratio Card ───────────────────────────────────────────────────────────────

function RatioCard({
  label, value, formatted, icon: Icon, healthKey, subtitle, benchmark,
}: {
  label:      string;
  value:      number | null;
  formatted:  string;
  icon:       React.ElementType;
  healthKey:  string;
  subtitle?:  string;
  benchmark?: string;
}) {
  const health = ratioHealth(healthKey, value);
  return (
    <div className={`flex-1 min-w-[140px] rounded-xl border p-3.5 transition-all hover:shadow-md ${healthColors[health]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-heading uppercase tracking-widest opacity-60 mb-1">{label}</p>
          <p className="text-base font-bold tabular-nums leading-tight">{formatted}</p>
          {subtitle && <p className="text-[9px] opacity-60 mt-0.5">{subtitle}</p>}
          {benchmark && <p className="text-[8px] opacity-50 mt-0.5 italic">{benchmark}</p>}
        </div>
        <div className={`rounded-lg p-1.5 bg-background/60 ${healthIconColors[health]}`}>
          <Icon size={12} />
        </div>
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
    <div id="bs-printable" className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Letterhead */}
      <div className="px-6 pt-5 pb-4 text-center border-b border-border bg-gradient-to-b from-muted/30 to-transparent">
        <h2 className="text-sm font-heading font-bold tracking-wide text-foreground uppercase">
          {companyName || "Consolidated — All Companies"}
        </h2>
        <h3 className="text-xs font-semibold text-foreground mt-1.5">Balance Sheet</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">{asOfLabel}</p>
        <p className="text-[9px] text-muted-foreground/50 mt-1">
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
    <tr className="bg-muted/30">
      <td colSpan={2} className="py-2 px-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/60">{roman}.</span>
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">{label}</span>
        </div>
      </td>
    </tr>
  );
}

// ─── Group Row (collapsible) ──────────────────────────────────────────────────

function GroupRow({
  group, openKey, onToggle, indent = 8,
}: {
  group:    StatementGroup;
  openKey:  string | null;
  onToggle: (k: string) => void;
  indent?:  number;
}) {
  const key       = `g-${group.groupId}`;
  const isOpen    = openKey === key;
  const clickable = group.heads.length > 0;

  return (
    <>
      <tr
        className={`border-b border-border/30 transition-colors ${clickable ? "cursor-pointer hover:bg-muted/25" : ""}`}
        onClick={() => clickable && onToggle(key)}
      >
        <td className="py-2 pr-3 text-[11px] text-foreground" style={{ paddingLeft: indent * 4 }}>
          <div className="flex items-center gap-2">
            {clickable ? (
              isOpen
                ? <ChevronDown size={10} className="text-primary/60 shrink-0" />
                : <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />
            ) : <span className="w-[10px] shrink-0" />}
            <span className={clickable ? "font-medium" : ""}>{group.groupName}</span>
          </div>
        </td>
        <td className="py-2 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium text-foreground w-36">
          {fmt(group.total)}
        </td>
      </tr>

      {isOpen && group.heads.length > 0 && (
        <tr>
          <td colSpan={2} className="pb-1.5">
            <div className="ml-4 mr-5 border-l-2 border-primary/20 pl-3 py-1 space-y-0.5" style={{ marginLeft: indent * 4 + 8 }}>
              {group.heads.map((h) => (
                <div key={h.id ?? h.name} className="flex items-center justify-between text-[10px] text-muted-foreground group">
                  <span className="truncate pr-4 group-hover:text-foreground transition-colors">{h.name}</span>
                  <Signed amount={h.amount} className="shrink-0 font-medium" />
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
  groups, openKey, onToggle, emptyLabel,
}: {
  groups: StatementGroup[];
  openKey: string | null;
  onToggle: (k: string) => void;
  emptyLabel: string;
}) {
  if (groups.length === 0) {
    return <tr><td colSpan={2} className="py-1.5 pl-8 text-[10px] text-muted-foreground italic">— {emptyLabel} —</td></tr>;
  }
  return (
    <>
      {groups.map((g) => (
        <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={onToggle} />
      ))}
    </>
  );
}

// ─── Section subtotal + wrapper ──────────────────────────────────────────────

function SectionBlock({ label, amount, children }: { label: string; amount: number; children: ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pt-2.5 pb-0.5 pl-5">
          <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">{label}</span>
        </td>
      </tr>
      {children}
      <tr className="border-t border-border/60">
        <td className="py-1.5 pl-8 pr-3 text-xs font-semibold text-muted-foreground">Sub-total — {label}</td>
        <td className="py-1.5 pl-3 pr-5 text-right text-xs font-semibold tabular-nums text-foreground w-36">{fmt(amount)}</td>
      </tr>
      <tr><td colSpan={2} className="py-1"><div className="border-t border-dashed border-border/40 mx-5" /></td></tr>
    </>
  );
}

// ─── Grand Total Row ──────────────────────────────────────────────────────────

function GrandTotalRow({ label, amount, variant }: { label: string; amount: number; variant: "liabilities" | "assets" }) {
  const colors = variant === "liabilities"
    ? "text-violet-700 dark:text-violet-400"
    : "text-emerald-700 dark:text-emerald-400";

  return (
    <tr className="border-t-2 border-double border-foreground/35">
      <td className={`py-2 pl-5 pr-3 text-xs font-bold ${colors}`}>{label}</td>
      <td className={`py-2 pl-3 pr-5 text-right text-xs font-bold tabular-nums w-36 ${colors}`}>
        {fmt(amount)}
      </td>
    </tr>
  );
}

// ─── Partners' Capital block ──────────────────────────────────────────────────
// Rendered on its own (not via SectionBlock/GroupRow) since it's a
// roll-forward, not a flat group list: Opening + Retained Earnings b/f +
// Further Capital + Net Profit − Drawings = Partners' Capital. Drawings
// expands to the partner-wise drill-down (Cash Withdrawal, Interest on
// Drawings, ...) per partner; the individual capital ledger heads (one per
// partner's Capital A/c) expand separately.

function PartnersCapitalBlock({
  data, openKey, onToggle,
}: {
  data: PartnersCapital;
  openKey: string | null;
  onToggle: (k: string) => void;
}) {
  const capitalKey = "capital-heads";
  const capitalOpen = openKey === capitalKey;

  return (
    <>
      <tr>
        <td colSpan={2} className="pt-2.5 pb-0.5 pl-5">
          <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">Partners' Capital</span>
        </td>
      </tr>

      <tr
        className={`border-b border-border/30 ${data.capitalHeads.length > 0 ? "cursor-pointer hover:bg-muted/25" : ""}`}
        onClick={() => data.capitalHeads.length > 0 && onToggle(capitalKey)}
      >
        <td className="py-1.5 pl-8 pr-3 text-[11px] text-foreground">
          <div className="flex items-center gap-2">
            {data.capitalHeads.length > 0 ? (
              capitalOpen
                ? <ChevronDown size={10} className="text-primary/60 shrink-0" />
                : <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />
            ) : <span className="w-[10px] shrink-0" />}
            Opening Partners' Capital
          </div>
        </td>
        <td className="py-1.5 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium w-36"><Signed amount={data.openingCapital} /></td>
      </tr>
      {capitalOpen && data.capitalHeads.length > 0 && (
        <tr>
          <td colSpan={2} className="pb-1.5">
            <div className="ml-16 mr-5 border-l-2 border-primary/20 pl-3 py-1 space-y-0.5">
              {data.capitalHeads.map((h) => (
                <div key={h.id ?? h.name} className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate pr-4">{h.name} <span className="opacity-50">(life-to-date)</span></span>
                  <Signed amount={h.amount} className="shrink-0 font-medium" />
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}

      {Math.abs(data.retainedEarningsPrior) > 0.005 && (
        <tr className="border-b border-border/30">
          <td className="py-1.5 pl-8 pr-3 text-[11px] text-muted-foreground">+ Retained Earnings b/f (Prior Years)</td>
          <td className="py-1.5 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium w-36"><Signed amount={data.retainedEarningsPrior} /></td>
        </tr>
      )}

      <tr className="border-b border-border/30">
        <td className="py-1.5 pl-8 pr-3 text-[11px] text-muted-foreground">+ Further Capital</td>
        <td className="py-1.5 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium w-36"><Signed amount={data.furtherCapital} /></td>
      </tr>

      <tr className="border-b border-border/30">
        <td className="py-1.5 pl-8 pr-3 text-[11px] text-muted-foreground">+ Net Profit (Current Period)</td>
        <td className="py-1.5 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium w-36"><Signed amount={data.netProfitCurrent} /></td>
      </tr>

      <tr className="border-b border-border/30">
        <td className="py-1.5 pl-8 pr-3 text-[11px] text-muted-foreground">− Partners' Drawings</td>
        <td className="py-1.5 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium w-36 text-red-600 dark:text-red-400">
          {data.drawings > 0.005 ? `(${fmt(data.drawings)})` : fmt(0)}
        </td>
      </tr>

      <tr className="border-t border-border/60">
        <td className="py-1.5 pl-8 pr-3 text-xs font-semibold text-muted-foreground">Sub-total — Partners' Capital</td>
        <td className="py-1.5 pl-3 pr-5 text-right text-xs font-semibold tabular-nums text-foreground w-36">{fmt(data.total)}</td>
      </tr>
      <tr><td colSpan={2} className="py-1"><div className="border-t border-dashed border-border/40 mx-5" /></td></tr>
    </>
  );
}

// ─── Partners' Drawings drill-down (own note, referenced from the capital
// block above) — flat list of drawings heads/groups, same GroupRow pattern
// as every other section. ─────────────────────────────────────────────────

function PartnersDrawingsNote({ groups, total, openKey, onToggle }: {
  groups: StatementGroup[]; total: number; openKey: string | null; onToggle: (k: string) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 bg-muted/30 border-b border-border/60">
        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
          Partners' Drawings — Detail
        </span>
        <span className="text-[11px] font-semibold tabular-nums">{fmt(total)}</span>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {groups.map((g) => (
            <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={onToggle} indent={2} />
          ))}
        </tbody>
      </table>
    </div>
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
      <table className="w-full border-collapse min-w-[480px]">
        <thead>
          <tr className="border-b-2 border-foreground/20">
            <th className="pb-2.5 pl-5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              Particulars
            </th>
            <th className="pb-2.5 pl-3 pr-5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-36">
              Amount ₹
            </th>
          </tr>
        </thead>
        <tbody>

          {/* ═══════════════ LIABILITIES ═══════════════ */}
          <SectionHeader roman="I" label="Liabilities" />

          <PartnersCapitalBlock data={data.partnersCapital} openKey={openKey} onToggle={toggle} />

          <SectionBlock label="Provisions & Reserves" amount={totalProvisionsReserves}>
            <GroupList groups={data.provisionsReserves} openKey={openKey} onToggle={toggle} emptyLabel="No provisions or reserves" />
          </SectionBlock>

          <SectionBlock label="Fixed Liabilities" amount={totalFixedLiabilities}>
            <GroupList groups={data.fixedLiabilities} openKey={openKey} onToggle={toggle} emptyLabel="No fixed liabilities" />
          </SectionBlock>

          <SectionBlock label="Current Liabilities" amount={totalCurrentLiabilities}>
            <GroupList groups={data.currentLiabilities} openKey={openKey} onToggle={toggle} emptyLabel="No current liabilities" />
          </SectionBlock>

          <GrandTotalRow label="Total Liabilities" amount={data.totals.liabilities} variant="liabilities" />

          {/* ═══════════════ ASSETS ═══════════════ */}
          <tr><td colSpan={2} className="pt-4" /></tr>
          <SectionHeader roman="II" label="Assets" />

          <tr>
            <td colSpan={2} className="pt-2.5 pb-0.5 pl-5">
              <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">Fixed Assets</span>
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="pt-1 pb-0.5 pl-7">
              <span className="text-[10px] font-semibold text-foreground/70">Tangible Assets</span>
            </td>
          </tr>
          <GroupList groups={data.fixedAssets.tangible} openKey={openKey} onToggle={toggle} emptyLabel="No tangible assets" />
          <tr>
            <td colSpan={2} className="pt-1.5 pb-0.5 pl-7">
              <span className="text-[10px] font-semibold text-foreground/70">Intangible Assets</span>
            </td>
          </tr>
          <GroupList groups={data.fixedAssets.intangible} openKey={openKey} onToggle={toggle} emptyLabel="No intangible assets" />
          <tr className="border-t border-border/60">
            <td className="py-1.5 pl-8 pr-3 text-xs font-semibold text-muted-foreground">Sub-total — Fixed Assets</td>
            <td className="py-1.5 pl-3 pr-5 text-right text-xs font-semibold tabular-nums text-foreground w-36">{fmt(totalFixedAssets)}</td>
          </tr>
          <tr><td colSpan={2} className="py-1"><div className="border-t border-dashed border-border/40 mx-5" /></td></tr>

          <SectionBlock label="Investments" amount={totalInvestments}>
            <GroupList groups={data.investments} openKey={openKey} onToggle={toggle} emptyLabel="No investments" />
          </SectionBlock>

          <SectionBlock label="Current Assets" amount={totalCurrentAssets}>
            <GroupList groups={data.currentAssets} openKey={openKey} onToggle={toggle} emptyLabel="No current assets" />
          </SectionBlock>

          <SectionBlock label="Fictitious Assets / Deferred Revenue Expenditure" amount={totalFictitiousAssets}>
            <GroupList groups={data.fictitiousAssets} openKey={openKey} onToggle={toggle} emptyLabel="No fictitious assets" />
          </SectionBlock>

          <GrandTotalRow label="Total Assets" amount={data.totals.assets} variant="assets" />

        </tbody>
      </table>

      <PartnersDrawingsNote
        groups={data.partnersDrawings}
        total={data.partnersDrawings.reduce((s, g) => s + g.total, 0)}
        openKey={openKey}
        onToggle={toggle}
      />

      {/* Balance check bar */}
      <div className={`mt-4 mx-0 flex items-center justify-between px-4 py-2.5 rounded-lg border text-xs font-medium ${
        data.balanced
          ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400"
      }`}>
        <div className="flex items-center gap-2">
          {data.balanced
            ? <CheckCircle2 size={13} />
            : <AlertTriangle size={13} />
          }
          <span>
            {data.balanced
              ? "Balance Sheet is balanced — Total Liabilities = Total Assets"
              : "Imbalance detected — Total Liabilities ≠ Total Assets. Check for unposted entries."}
          </span>
        </div>
        <span className="tabular-nums font-bold ml-4 shrink-0">
          Assets: {fmt(data.totals.assets)} · Liabilities: {fmt(data.totals.liabilities)}
          {!data.balanced && <> · Difference: {fmt(data.totals.difference)}</>}
        </span>
      </div>

      {/* Note */}
      <div className="mt-3 pt-2.5 border-t border-border/40">
        <p className="text-[9px] text-muted-foreground/50 italic">
          Prepared per the classic vertical Balance Sheet format for partnership/proprietorship entities. Every figure is pulled live
          from the account groups tagged in Account Group Master — click any row (›) to view the underlying ledger heads.
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
        { side: "Liabilities", group: "Partners' Capital", head: "Retained Earnings b/f", amount: data.partnersCapital.retainedEarningsPrior },
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
      <FinanceShell
        title="Balance Sheet"
        subtitle="Partners' Capital, Liabilities & Assets — classic vertical format"
        icon={Scale}
      >

        {/* ── Filter Toolbar ── */}
        <div className="mb-5 rounded-xl border border-border bg-muted/20 p-4 space-y-3">

          {/* Quick date buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mr-1">As On</span>
            {[
              { label: "Today",        fn: setToday },
              { label: "H1 End (Sep)", fn: setFYMid },
              { label: "FY End (Mar)", fn: setFYEnd },
            ].map(({ label, fn }) => (
              <button
                key={label}
                onClick={fn}
                className="px-2.5 h-7 rounded-md text-[10px] font-medium bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/50 transition-all"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-end gap-3">

            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                <CalendarDays size={9} /> As at Date
              </span>
              <input
                type="date" value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
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

            <div className="flex items-end gap-2 ml-auto">
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
                <ExportMenu title="Balance Sheet" filename="balance-sheet" columns={exportColumns} data={exportRows} />
              )}
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={16} /> Loading balance sheet…
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 py-5 px-4 rounded-xl bg-red-50/50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* ── Main Content ── */}
        {!loading && !error && data && (() => {
          const r = ratios;

          return (
            <>
              {/* ── Summary headline ── */}
              <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* Total Assets card */}
                <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-heading uppercase tracking-widest text-emerald-700/60 dark:text-emerald-400/60 mb-1">Total Assets</p>
                      <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight">
                        {fmt(data.totals.assets)}
                      </p>
                      {r && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          Current: {fmt(r.totalCurrentAssets)} · Non-Current: {fmt(r.totalNonCurrentAssets)}
                        </p>
                      )}
                    </div>
                    <Scale size={28} className="text-emerald-500/30 shrink-0 mt-1" />
                  </div>
                </div>

                {/* Total Liabilities card */}
                <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-violet-500/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-heading uppercase tracking-widest text-violet-700/60 dark:text-violet-400/60 mb-1">Total Liabilities</p>
                      <p className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-400 tracking-tight">
                        {fmt(data.totals.liabilities)}
                      </p>
                      {r && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          Partners' Capital: {fmt(r.totalEquity)} · Other Liabilities: {fmt(r.totalCurrentLiabilities + r.totalNonCurrentLiabilities)}
                        </p>
                      )}
                    </div>
                    <ShieldCheck size={28} className="text-violet-500/30 shrink-0 mt-1" />
                  </div>
                </div>
              </div>

              {/* ── Net P&L carried ── */}
              {Math.abs(data.netProfit) > 0.005 && (
                <div className={`mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs ${
                  data.netProfit >= 0
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400"
                }`}>
                  <div className="flex items-center gap-2">
                    {data.netProfit >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    <span className="font-medium">
                      {data.netProfit >= 0 ? "Profit" : "Loss"} for the period, pulled into Partners' Capital:
                    </span>
                  </div>
                  <span className="font-bold tabular-nums">
                    {data.netProfit < 0 ? "(" : ""}{fmt(data.netProfit)}{data.netProfit < 0 ? ")" : ""}
                  </span>
                </div>
              )}

              {/* ── Financial Ratios ── */}
              {r && (
                <div className="mb-5">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-2.5 flex items-center gap-1.5">
                    <Activity size={9} /> Key Financial Ratios
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <RatioCard
                      label="Current Ratio"
                      value={r.currentRatio}
                      formatted={r2(r.currentRatio)}
                      icon={ShieldCheck}
                      healthKey="currentRatio"
                      subtitle="Current Assets / Current Liabilities"
                      benchmark="Ideal ≥ 2.0"
                    />
                    <RatioCard
                      label="Quick Ratio"
                      value={r.quickRatio}
                      formatted={r2(r.quickRatio)}
                      icon={Activity}
                      healthKey="quickRatio"
                      subtitle="(Current Assets − Stock) / Current Liabilities"
                      benchmark="Ideal ≥ 1.0"
                    />
                    <RatioCard
                      label="Working Capital"
                      value={r.workingCapital}
                      formatted={`₹${fmt(r.workingCapital)}`}
                      icon={Banknote}
                      healthKey="workingCapital"
                      subtitle="Current Assets − Current Liabilities"
                    />
                    <RatioCard
                      label="Debt / Capital"
                      value={r.debtToEquity}
                      formatted={r2(r.debtToEquity)}
                      icon={Target}
                      healthKey="debtToEquity"
                      subtitle="Total Liabilities / Partners' Capital"
                      benchmark="Ideal ≤ 1.0"
                    />
                  </div>

                  {/* Ratio interpretation guide */}
                  <div className="mt-2.5 flex flex-wrap gap-3 text-[9px] text-muted-foreground/50">
                    {[
                      { color: "bg-emerald-500", label: "Healthy" },
                      { color: "bg-amber-500",   label: "Monitor" },
                      { color: "bg-red-500",      label: "Attention Needed" },
                    ].map(({ color, label }) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${color} opacity-70`} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Refresh overlay ── */}
              {loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Loader2 size={11} className="animate-spin" /> Refreshing…
                </div>
              )}

              {/* ── Vertical Statement ── */}
              <VerticalStatement data={data} asOfLabel={asOfLabel} />

              {/* ── Info ── */}
              <div className="mt-4 flex items-start gap-2 text-[10px] text-muted-foreground/60">
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

      </FinanceShell>

      {/* Print styles */}
      <style>{`
        @media print {
          body > *:not(#bs-printable) { display: none !important; }
          #bs-printable { display: block !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </>
  );
}
