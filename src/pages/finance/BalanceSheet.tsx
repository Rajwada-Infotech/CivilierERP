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
  Layers,
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
  liabilities:  StatementGroup[];
  assets:       StatementGroup[];
  totals:       { liabilities: number; assets: number };
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
      {neg ? "(" : ""}₹{fmt(amount)}{neg ? ")" : ""}
    </span>
  );
}

// Classify a group name for display badge
function classifyGroup(name: string): "current" | "non-current" | "equity" {
  const n = name.toLowerCase();
  if (n.includes("share capital") || n.includes("reserve") || n.includes("surplus") ||
      n.includes("equity") || n.includes("profit & loss") || n.includes("profit and loss")) return "equity";
  if (n.includes("cash") || n.includes("bank") || n.includes("receivable") ||
      n.includes("inventory") || n.includes("stock") || n.includes("advance") ||
      n.includes("current") || n.includes("debtor") || n.includes("prepaid") ||
      n.includes("payable") || n.includes("creditor") || n.includes("short") ||
      n.includes("overdraft") || n.includes("provision")) return "current";
  return "non-current";
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
  icon:       React.FC<{ size?: number; className?: string }>;
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
  companyName, entityType, asOfLabel, children,
}: {
  companyName: string | null;
  entityType:  string | null;
  asOfLabel:   string;
  children:    ReactNode;
}) {
  return (
    <div id="bs-printable" className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Letterhead */}
      <div className="px-6 pt-5 pb-4 text-center border-b border-border bg-gradient-to-b from-muted/30 to-transparent">
        {entityType && (
          <div className="flex justify-center mb-1.5">
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase tracking-wider">
              {entityType}
            </span>
          </div>
        )}
        <h2 className="text-sm font-heading font-bold tracking-wide text-foreground uppercase">
          {companyName || "Consolidated — All Companies"}
        </h2>
        <h3 className="text-xs font-semibold text-foreground mt-1.5">Balance Sheet</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">{asOfLabel}</p>
        <p className="text-[9px] text-muted-foreground/50 mt-1">
          (All amounts in Indian Rupees ₹, unless otherwise stated) · As per Schedule III, Division II, Companies Act 2013
        </p>
      </div>
      <div className="px-5 py-4 overflow-x-auto">{children}</div>
    </div>
  );
}

// ─── Section Header Row ───────────────────────────────────────────────────────

function SectionHeader({ roman, label, badge }: { roman: string; label: string; badge?: string }) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={4} className="py-2 px-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/60">{roman}.</span>
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">{label}</span>
          {badge && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{badge}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Group Row (collapsible) ──────────────────────────────────────────────────

function GroupRow({
  group, openKey, onToggle, showNote, noteNum,
}: {
  group:    StatementGroup;
  openKey:  string | null;
  onToggle: (k: string) => void;
  showNote?: boolean;
  noteNum?:  number;
}) {
  const key       = String(group.groupId);
  const isOpen    = openKey === key;
  const clickable = group.heads.length > 0;
  const cls       = classifyGroup(group.groupName);

  const badgeStyle = {
    current:     "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    "non-current": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    equity:      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  }[cls];

  return (
    <>
      <tr
        className={`border-b border-border/30 transition-colors ${clickable ? "cursor-pointer hover:bg-muted/25" : ""}`}
        onClick={() => clickable && onToggle(key)}
      >
        {/* Indent + label */}
        <td className="py-2 pl-8 pr-3 text-[11px] text-foreground">
          <div className="flex items-center gap-2">
            {clickable && (
              isOpen
                ? <ChevronDown size={10} className="text-primary/60 shrink-0" />
                : <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />
            )}
            {!clickable && <span className="w-[10px] shrink-0" />}
            <span className={clickable ? "font-medium" : ""}>{group.groupName}</span>
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-medium ${badgeStyle}`}>
              {cls === "non-current" ? "Non-Current" : cls.charAt(0).toUpperCase() + cls.slice(1)}
            </span>
          </div>
        </td>
        {/* Note ref */}
        <td className="py-2 px-3 text-right text-[9px] text-muted-foreground/40 w-16">
          {showNote && noteNum ? noteNum : ""}
        </td>
        {/* Sub-amount (heads sum) */}
        <td className="py-2 px-3 text-right text-[11px] tabular-nums text-muted-foreground/70 w-32">
          {group.heads.length > 1 ? `₹${fmt(group.total)}` : ""}
        </td>
        {/* Main amount */}
        <td className="py-2 pl-3 pr-5 text-right text-[11px] tabular-nums font-medium text-foreground w-36">
          ₹{fmt(group.total)}
        </td>
      </tr>

      {/* Drilldown */}
      {isOpen && group.heads.length > 0 && (
        <tr>
          <td colSpan={4} className="pb-1.5">
            <div className="ml-16 mr-5 border-l-2 border-primary/20 pl-3 py-1 space-y-0.5">
              {group.heads.map((h) => (
                <div key={h.id ?? h.name} className="flex items-center justify-between text-[10px] text-muted-foreground group">
                  <span className="truncate pr-4 group-hover:text-foreground transition-colors">{h.name}</span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {h.amount < -0.005 ? "(" : ""}₹{fmt(h.amount)}{h.amount < -0.005 ? ")" : ""}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Subtotal Row ─────────────────────────────────────────────────────────────

function SubtotalRow({ label, amount, muted }: { label: string; amount: number; muted?: boolean }) {
  return (
    <tr className="border-t border-border/60">
      <td colSpan={3} className={`py-1.5 pl-8 pr-3 text-xs font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
      </td>
      <td className="py-1.5 pl-3 pr-5 text-right text-xs font-semibold tabular-nums text-foreground w-36">
        ₹{fmt(amount)}
      </td>
    </tr>
  );
}

// ─── Grand Total Row ──────────────────────────────────────────────────────────

function GrandTotalRow({ label, amount, variant }: { label: string; amount: number; variant: "liabilities" | "assets" }) {
  const colors = variant === "liabilities"
    ? "text-violet-700 dark:text-violet-400"
    : "text-emerald-700 dark:text-emerald-400";

  return (
    <tr className="border-t-2 border-double border-foreground/35">
      <td colSpan={3} className={`py-2 pl-5 pr-3 text-xs font-bold ${colors}`}>{label}</td>
      <td className={`py-2 pl-3 pr-5 text-right text-xs font-bold tabular-nums w-36 ${colors}`}>
        ₹{fmt(amount)}
      </td>
    </tr>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function DividerRow() {
  return (
    <tr>
      <td colSpan={4} className="py-0.5">
        <div className="border-t border-dashed border-border/40 mx-5" />
      </td>
    </tr>
  );
}

// ─── Schedule III Vertical Statement ─────────────────────────────────────────

function VerticalStatement({
  data, asOfLabel,
}: {
  data:     BalanceSheetResponse;
  asOfLabel: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));

  const liabilities = data.liabilities;
  const assets      = data.assets;
  const totalL      = data.totals.liabilities;
  const totalA      = data.totals.assets;

  // Classify liabilities into Equity vs NonCurrent vs Current
  const equityGroups       = liabilities.filter((g) => classifyGroup(g.groupName) === "equity");
  const nonCurrentLiabGroups = liabilities.filter((g) => {
    const c = classifyGroup(g.groupName);
    return c === "non-current";
  });
  const currentLiabGroups  = liabilities.filter((g) => {
    const c = classifyGroup(g.groupName);
    return c === "current";
  });

  const totalEquity       = equityGroups.reduce((s, g) => s + g.total, 0);
  const totalNonCurrLiab  = nonCurrentLiabGroups.reduce((s, g) => s + g.total, 0);
  const totalCurrLiab     = currentLiabGroups.reduce((s, g) => s + g.total, 0);

  // Classify assets
  const nonCurrentAssets = assets.filter((g) => classifyGroup(g.groupName) === "non-current");
  const currentAssets    = assets.filter((g) => classifyGroup(g.groupName) !== "non-current");

  const totalNonCurrAsset = nonCurrentAssets.reduce((s, g) => s + g.total, 0);
  const totalCurrAsset    = currentAssets.reduce((s, g) => s + g.total, 0);

  let noteCounter = 1;

  return (
    <StatementSheet
      companyName={data.companyName}
      entityType={data.entityType}
      asOfLabel={asOfLabel}
    >
      <table className="w-full border-collapse min-w-[560px]">
        <thead>
          <tr className="border-b-2 border-foreground/20">
            <th className="pb-2.5 pl-5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              Particulars
            </th>
            <th className="pb-2.5 px-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-16">
              Note No.
            </th>
            <th className="pb-2.5 px-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-32">
              Sub-Total ₹
            </th>
            <th className="pb-2.5 pl-3 pr-5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-36">
              Amount ₹
            </th>
          </tr>
        </thead>
        <tbody>

          {/* ═══════════════════════════════════════════════ */}
          {/*  EQUITY AND LIABILITIES                         */}
          {/* ═══════════════════════════════════════════════ */}
          <SectionHeader roman="I" label="Equity and Liabilities" />

          {/* (1) Shareholders' Funds / Equity */}
          <tr>
            <td colSpan={4} className="pt-2 pb-0.5 pl-6">
              <span className="text-[10px] font-semibold text-foreground/70">(1) Shareholders' Funds</span>
            </td>
          </tr>
          {equityGroups.length > 0 ? (
            equityGroups.map((g) => (
              <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={toggle}
                showNote noteNum={noteCounter++} />
            ))
          ) : (
            <tr><td colSpan={4} className="py-1 pl-16 text-[10px] text-muted-foreground italic">— No equity entries —</td></tr>
          )}
          <SubtotalRow label="Sub-total — Shareholders' Funds" amount={totalEquity} muted />
          <DividerRow />

          {/* (2) Non-Current Liabilities */}
          <tr>
            <td colSpan={4} className="pt-2 pb-0.5 pl-6">
              <span className="text-[10px] font-semibold text-foreground/70">(2) Non-Current Liabilities</span>
            </td>
          </tr>
          {nonCurrentLiabGroups.length > 0 ? (
            nonCurrentLiabGroups.map((g) => (
              <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={toggle}
                showNote noteNum={noteCounter++} />
            ))
          ) : (
            <tr><td colSpan={4} className="py-1 pl-16 text-[10px] text-muted-foreground italic">— No non-current liabilities —</td></tr>
          )}
          <SubtotalRow label="Sub-total — Non-Current Liabilities" amount={totalNonCurrLiab} muted />
          <DividerRow />

          {/* (3) Current Liabilities */}
          <tr>
            <td colSpan={4} className="pt-2 pb-0.5 pl-6">
              <span className="text-[10px] font-semibold text-foreground/70">(3) Current Liabilities</span>
            </td>
          </tr>
          {currentLiabGroups.length > 0 ? (
            currentLiabGroups.map((g) => (
              <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={toggle}
                showNote noteNum={noteCounter++} />
            ))
          ) : (
            <tr><td colSpan={4} className="py-1 pl-16 text-[10px] text-muted-foreground italic">— No current liabilities —</td></tr>
          )}
          <SubtotalRow label="Sub-total — Current Liabilities" amount={totalCurrLiab} muted />

          {/* TOTAL EQUITY & LIABILITIES */}
          <GrandTotalRow label="Total — Equity and Liabilities (I)" amount={totalL} variant="liabilities" />

          {/* ═══════════════════════════════════════════════ */}
          {/*  ASSETS                                         */}
          {/* ═══════════════════════════════════════════════ */}
          <tr><td colSpan={4} className="pt-4" /></tr>
          <SectionHeader roman="II" label="Assets" />

          {/* (1) Non-Current Assets */}
          <tr>
            <td colSpan={4} className="pt-2 pb-0.5 pl-6">
              <span className="text-[10px] font-semibold text-foreground/70">(1) Non-Current Assets</span>
            </td>
          </tr>
          {nonCurrentAssets.length > 0 ? (
            nonCurrentAssets.map((g) => (
              <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={toggle}
                showNote noteNum={noteCounter++} />
            ))
          ) : (
            <tr><td colSpan={4} className="py-1 pl-16 text-[10px] text-muted-foreground italic">— No non-current assets —</td></tr>
          )}
          <SubtotalRow label="Sub-total — Non-Current Assets" amount={totalNonCurrAsset} muted />
          <DividerRow />

          {/* (2) Current Assets */}
          <tr>
            <td colSpan={4} className="pt-2 pb-0.5 pl-6">
              <span className="text-[10px] font-semibold text-foreground/70">(2) Current Assets</span>
            </td>
          </tr>
          {currentAssets.length > 0 ? (
            currentAssets.map((g) => (
              <GroupRow key={String(g.groupId)} group={g} openKey={openKey} onToggle={toggle}
                showNote noteNum={noteCounter++} />
            ))
          ) : (
            <tr><td colSpan={4} className="py-1 pl-16 text-[10px] text-muted-foreground italic">— No current assets —</td></tr>
          )}
          <SubtotalRow label="Sub-total — Current Assets" amount={totalCurrAsset} muted />

          {/* TOTAL ASSETS */}
          <GrandTotalRow label="Total — Assets (II)" amount={totalA} variant="assets" />

        </tbody>
      </table>

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
              ? "Balance Sheet is balanced — Total Equity & Liabilities = Total Assets"
              : "Imbalance detected — Equity & Liabilities ≠ Assets. Check for unposted entries."}
          </span>
        </div>
        <span className="tabular-nums font-bold ml-4 shrink-0">
          I: ₹{fmt(totalL)} · II: ₹{fmt(totalA)}
        </span>
      </div>

      {/* Statutory note */}
      <div className="mt-3 pt-2.5 border-t border-border/40">
        <p className="text-[9px] text-muted-foreground/50 italic">
          This Balance Sheet is prepared in accordance with Schedule III, Division II of the Companies Act, 2013 and the applicable Indian Accounting Standards (Ind AS).
          The accompanying notes form an integral part of these financial statements. Click any group row (›) to expand and view individual ledger head balances.
          The current / non-current classification is based on the account group name. Net Profit / Loss for the period is rolled into Shareholders' Funds as "Profit & Loss A/c (life-to-date)".
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
        ...data.liabilities.flatMap((g) =>
          g.heads.map((h) => ({ side: "Liabilities & Equity", group: g.groupName, head: h.name, amount: h.amount })),
        ),
        ...data.assets.flatMap((g) =>
          g.heads.map((h) => ({ side: "Assets", group: g.groupName, head: h.name, amount: h.amount })),
        ),
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
        subtitle="Equity, Liabilities & Assets as per Schedule III, Companies Act 2013"
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
                        ₹{fmt(data.totals.assets)}
                      </p>
                      {r && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          Current: ₹{fmt(r.totalCurrentAssets)} · Non-Current: ₹{fmt(r.totalNonCurrentAssets)}
                        </p>
                      )}
                    </div>
                    <Layers size={28} className="text-emerald-500/30 shrink-0 mt-1" />
                  </div>
                </div>

                {/* Total Equity & Liabilities card */}
                <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-violet-500/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-heading uppercase tracking-widest text-violet-700/60 dark:text-violet-400/60 mb-1">Total Equity & Liabilities</p>
                      <p className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-400 tracking-tight">
                        ₹{fmt(data.totals.liabilities)}
                      </p>
                      {r && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          Equity: ₹{fmt(r.totalEquity)} · Liabilities: ₹{fmt(r.totalCurrentLiabilities + r.totalNonCurrentLiabilities)}
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
                      Retained {data.netProfit >= 0 ? "Profit" : "Loss"} carried into Shareholders' Funds:
                    </span>
                  </div>
                  <span className="font-bold tabular-nums">
                    {data.netProfit < 0 ? "(" : ""}₹{fmt(data.netProfit)}{data.netProfit < 0 ? ")" : ""}
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
                      label="Debt / Equity"
                      value={r.debtToEquity}
                      formatted={r2(r.debtToEquity)}
                      icon={Target}
                      healthKey="debtToEquity"
                      subtitle="Total Liabilities / Shareholders' Funds"
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

              {/* ── Entity info ── */}
              {data.entityType && (
                <div className="mt-4 flex items-start gap-2 text-[10px] text-muted-foreground/60">
                  <Info size={11} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>{data.entityType}</strong> · Schedule III, Division II format applied.
                    Current / Non-Current classification is heuristic-based on account group names.
                    For regulatory filing, please verify with your statutory auditor.
                  </span>
                </div>
              )}
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
