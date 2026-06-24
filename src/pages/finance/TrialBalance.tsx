import { useState, useCallback, useRef, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Search,
  TrendingUp,
  TrendingDown,
  Scale,
  IndianRupee,
  CalendarDays,
  Folder,
  FolderOpen,
  Building,
  Briefcase,
  FolderKanban,
  Calendar,
  CalendarRange,
  CalendarCheck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalancePair {
  debit: number;
  credit: number;
}

interface TBNode {
  id: number;
  name: string;
  code?: string | null;
  level: number;
  isGroup: boolean;
  type?: string;
  children: TBNode[];
  opening: BalancePair;
  transactions: BalancePair;
  closing: BalancePair;
}

interface TBSummary {
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
}

interface TBResponse {
  rows: TBNode[];
  summary: TBSummary;
  asOf: string;
  from: string;
  to: string;
}

interface Option {
  id: number;
  label: string;
  belongs_to?: string;
  company_id?: number;
  enterprise_id?: number;
}

interface FinYearRow {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus?: number | boolean;
  FisLocked?: number | boolean;
}

type FilterMode = "fy" | "range" | "ason";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => (n === 0 ? "—" : formatINR(n));

function fmtDate(s: string) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toDateStr(s: string) {
  return s ? s.slice(0, 10) : "";
}

const TYPE_DOT: Record<string, string> = {
  S: "bg-blue-400",
  C: "bg-orange-400",
  B: "bg-emerald-400",
  A: "bg-purple-400",
  GL: "bg-primary/70",
};
const TYPE_LABEL: Record<string, string> = {
  S: "Supplier",
  C: "Contractor",
  B: "Bank",
  A: "Customer",
  GL: "GL",
};

// Does this single node (ignoring children) have any nonzero value?
function nodeHasOwnValue(n: TBNode): boolean {
  return (
    n.opening.debit !== 0 ||
    n.opening.credit !== 0 ||
    n.transactions.debit !== 0 ||
    n.transactions.credit !== 0 ||
    n.closing.debit !== 0 ||
    n.closing.credit !== 0
  );
}

// Prune the tree to only the branches that have activity somewhere in their
// subtree. A group is kept (with ALL of its ancestors) as long as it, or any
// descendant, has a nonzero opening/transaction/closing value — i.e. the
// "whole nest" stays visible whenever there's a transaction anywhere in it.
// Groups whose entire subtree is all-zero are dropped.
function pruneToActive(nodes: TBNode[]): TBNode[] {
  function walk(n: TBNode): TBNode | null {
    const keptChildren = n.children
      .map(walk)
      .filter((c): c is TBNode => c !== null);
    const keep = nodeHasOwnValue(n) || keptChildren.length > 0;
    if (!keep) return null;
    return { ...n, children: keptChildren };
  }
  return nodes.map(walk).filter((n): n is TBNode => n !== null);
}

function flattenVisible(
  nodes: TBNode[],
  expanded: Set<number>,
  search: string,
): TBNode[] {
  const result: TBNode[] = [];
  const q = search.toLowerCase();
  function hasMatch(n: TBNode): boolean {
    if (!q) return true;
    if (
      n.name.toLowerCase().includes(q) ||
      (n.code ?? "").toLowerCase().includes(q)
    )
      return true;
    return n.children.some(hasMatch);
  }
  function walk(n: TBNode) {
    if (!hasMatch(n)) return;
    result.push(n);
    if (expanded.has(n.id) || q) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

// Flatten entire tree for export (ignores expand state, exports everything)
function flattenAll(nodes: TBNode[]): TBNode[] {
  const result: TBNode[] = [];
  function walk(n: TBNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

// ─── Export column definitions ────────────────────────────────────────────────

const TB_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Account", accessor: "name" },
  { header: "Code", accessor: "code" },
  {
    header: "Type",
    accessor: (r) => ((r as any).isGroup ? "Group" : ((r as any).type ?? "")),
  },
  {
    header: "Opening Dr",
    accessor: (r) => formatINR((r as any).opening?.debit ?? 0),
  },
  {
    header: "Opening Cr",
    accessor: (r) => formatINR((r as any).opening?.credit ?? 0),
  },
  {
    header: "Transaction Dr",
    accessor: (r) => formatINR((r as any).transactions?.debit ?? 0),
  },
  {
    header: "Transaction Cr",
    accessor: (r) => formatINR((r as any).transactions?.credit ?? 0),
  },
  {
    header: "Closing Dr",
    accessor: (r) => formatINR((r as any).closing?.debit ?? 0),
  },
  {
    header: "Closing Cr",
    accessor: (r) => formatINR((r as any).closing?.credit ?? 0),
  },
];

// ─── TBRow ────────────────────────────────────────────────────────────────────

function TBRow({
  node,
  expanded,
  onToggle,
}: {
  node: TBNode;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasKids = node.children.length > 0;
  const indent = node.level * 20;
  const hasAnyValue =
    node.opening.debit > 0 ||
    node.opening.credit > 0 ||
    node.transactions.debit > 0 ||
    node.transactions.credit > 0;
  const dot = node.type ? TYPE_DOT[node.type] : null;

  return (
    <tr
      className={`border-b border-border/40 transition-colors ${
        node.isGroup
          ? node.level === 0
            ? "bg-muted/35 hover:bg-muted/50"
            : "bg-muted/15 hover:bg-muted/28"
          : "hover:bg-muted/10"
      }`}
    >
      <td className="py-2.5 pr-3" style={{ paddingLeft: `${indent + 14}px` }}>
        <div className="flex items-center gap-2">
          {node.isGroup && hasKids ? (
            <button
              onClick={() => onToggle(node.id)}
              className="flex items-center justify-center w-4 h-4 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {node.isGroup ? (
            <span className="shrink-0 text-amber-400/80">
              {isOpen && hasKids ? (
                <FolderOpen size={13} />
              ) : (
                <Folder size={13} />
              )}
            </span>
          ) : dot ? (
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          ) : (
            <span className="w-2 shrink-0" />
          )}

          <span
            className={`text-sm leading-tight ${
              node.isGroup
                ? node.level === 0
                  ? "font-heading font-bold text-foreground tracking-wide uppercase text-[11px]"
                  : "font-heading font-semibold text-foreground/90 text-xs uppercase tracking-wide"
                : "text-foreground/80 text-xs"
            }`}
          >
            {node.name}
          </span>

          {node.code && (
            <span className="text-[10px] font-mono text-muted-foreground/50">
              {node.code}
            </span>
          )}
          {!node.isGroup && node.type && (
            <span className="text-[9px] font-heading uppercase tracking-wider text-muted-foreground/40">
              {TYPE_LABEL[node.type] ?? node.type}
            </span>
          )}
          {!node.isGroup && !hasAnyValue && (
            <span className="text-[10px] text-muted-foreground/35 italic ml-0.5">
              no transactions
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-l border-border/30">
        {fmt(node.opening.debit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">
        {fmt(node.opening.credit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground">
        {fmt(node.transactions.debit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">
        {fmt(node.transactions.credit)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.debit > 0 ? "text-rose-400" : "text-muted-foreground/35"}`}
      >
        {fmt(node.closing.debit)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.credit > 0 ? "text-emerald-400" : "text-muted-foreground/35"}`}
      >
        {fmt(node.closing.credit)}
      </td>
    </tr>
  );
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  icon: Icon,
  value,
  onChange,
  options,
  placeholder,
  loading: isLoading,
}: {
  label: string;
  icon: React.ElementType;
  value: number | null;
  onChange: (id: number | null, opt: Option | null) => void;
  options: Option[];
  placeholder: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 w-full sm:min-w-[140px] sm:w-auto">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
        <Icon size={9} /> {label}
      </span>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange(
              id,
              id ? (options.find((o) => o.id === id) ?? null) : null,
            );
          }}
          disabled={isLoading}
          className="h-8 w-full pl-2.5 pr-7 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none disabled:opacity-50 cursor-pointer"
        >
          <option value="">{isLoading ? "Loading…" : placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={11}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
    </div>
  );
}

// ─── Mode Tab ─────────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-heading font-semibold tracking-wide transition-all border ${
        active
          ? "bg-primary text-white border-primary shadow-sm"
          : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted"
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// ─── DateField ────────────────────────────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
  highlight = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
      <div className="relative">
        <CalendarDays
          size={11}
          className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${highlight ? "text-primary/70" : "text-muted-foreground/70"}`}
        />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-8 pl-8 pr-2 rounded-lg text-xs bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${
            highlight
              ? "border border-primary/50 ring-1 ring-primary/20"
              : "border border-border"
          }`}
        />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrialBalance() {
  // ── filter mode ───────────────────────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<FilterMode>("fy");

  // ── fin year master ───────────────────────────────────────────────────────
  const [finYears, setFinYears] = useState<FinYearRow[]>([]);
  const [finYearsLoading, setFinYearsLoading] = useState(true);
  const [selectedFYId, setSelectedFYId] = useState<number | null>(null);
  const selectedFY = finYears.find((f) => f.FId === selectedFYId) ?? null;

  // ── period dates ──────────────────────────────────────────────────────────
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asOn, setAsOn] = useState("");

  // ── entity filters ────────────────────────────────────────────────────────
  const [enterprises, setEnterprises] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [allCompanies, setAllCompanies] = useState<Option[]>([]);
  const [allProjects, setAllProjects] = useState<Option[]>([]);
  const [selEnterprise, setSelEnterprise] = useState<Option | null>(null);
  const [selCompany, setSelCompany] = useState<Option | null>(null);
  const [selProject, setSelProject] = useState<Option | null>(null);

  // ── data ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<TBNode[]>([]);
  const [summary, setSummary] = useState<TBSummary | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // ── load fin years ────────────────────────────────────────────────────────
  useEffect(() => {
    setFinYearsLoading(true);
    fetchWithAuth("/api/fin-year")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: FinYearRow[]) => {
        // Only unlocked fin years are selectable for Trial Balance reporting —
        // locked years are closed for the period and shouldn't be queried here.
        const unlocked = data.filter(
          (f) => !(f.FisLocked === 1 || f.FisLocked === true),
        );
        const sorted = [...unlocked].sort(
          (a, b) =>
            new Date(b.FEndDate).getTime() - new Date(a.FEndDate).getTime(),
        );
        setFinYears(sorted);
        if (sorted.length > 0) {
          const active =
            sorted.find((f) => f.FStatus === 1 || f.FStatus === true) ??
            sorted[0];
          setSelectedFYId(active.FId);
          const f = toDateStr(active.FStartDate);
          const t = toDateStr(active.FEndDate);
          setFrom(f);
          setTo(t);
        }
      })
      .catch(() => {})
      .finally(() => setFinYearsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load entity options ───────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [eRes, cRes, pRes] = await Promise.all([
          fetchWithAuth("/api/enterprises/options?business_type=E"),
          fetchWithAuth("/api/enterprises/options?business_type=C"),
          fetchWithAuth("/api/enterprises/options?business_type=P"),
        ]);
        if (eRes.ok) setEnterprises(await eRes.json());
        if (cRes.ok) {
          const d = await cRes.json();
          setAllCompanies(d);
          setCompanies(d);
        }
        if (pRes.ok) {
          const d = await pRes.json();
          setAllProjects(d);
          setProjects(d);
        }
      } catch {
        /* silent */
      }
    }
    load();
  }, []);

  // ── cascade handlers ──────────────────────────────────────────────────────
  function handleEnterpriseChange(id: number | null, opt: Option | null) {
    setSelEnterprise(opt);
    setSelCompany(null);
    setSelProject(null);
    setCompanies(
      id ? allCompanies.filter((c) => c.enterprise_id === id) : allCompanies,
    );
    setProjects(allProjects);
  }
  function handleCompanyChange(id: number | null, opt: Option | null) {
    setSelCompany(opt);
    setSelProject(null);
    setProjects(
      id
        ? allProjects.filter((p) => p.company_id === id)
        : selEnterprise
          ? allProjects.filter((p) =>
              allCompanies
                .filter((c) => c.enterprise_id === selEnterprise.id)
                .some((c) => c.id === p.company_id),
            )
          : allProjects,
    );
  }

  // ── FY selection ──────────────────────────────────────────────────────────
  function handleFYChange(id: number | null) {
    setSelectedFYId(id);
    const fy = finYears.find((f) => f.FId === id);
    if (fy) {
      setFrom(toDateStr(fy.FStartDate));
      setTo(toDateStr(fy.FEndDate));
    }
  }

  // ── mode switch ───────────────────────────────────────────────────────────
  function switchMode(mode: FilterMode) {
    setFilterMode(mode);
    if (mode === "fy" && selectedFY) {
      setFrom(toDateStr(selectedFY.FStartDate));
      setTo(toDateStr(selectedFY.FEndDate));
      setAsOn("");
    }
  }

  // ── effective params per mode ─────────────────────────────────────────────
  function getEffectiveParams() {
    if (filterMode === "ason") return { f: from, t: asOn || to, ao: asOn };
    return { f: from, t: to, ao: "" };
  }

  // ── export/refresh disabled? ──────────────────────────────────────────────
  const notReady =
    loading ||
    (filterMode === "fy" && !selectedFYId) ||
    (filterMode === "range" && (!from || !to)) ||
    (filterMode === "ason" && !asOn);

  // ── fetch ─────────────────────────────────────────────────────────────────
  async function fetchDataInner(f: string, t: string, ao: string) {
    if (!f || !t) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const effectiveTo = ao || t;
      let url = `/api/trial-balance?from=${f}&to=${effectiveTo}`;
      if (selCompany?.id) url += `&companyId=${selCompany.id}`;
      if (selProject?.id) url += `&projectId=${selProject.id}`;
      const res = await fetchWithAuth(url, { signal: abortRef.current.signal });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data: TBResponse = await res.json();
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setAsOf(data.asOf ?? null);
      setExpanded(new Set(data.rows.map((r) => r.id)));
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fetchData = useCallback(() => {
    const { f, t, ao } = getEffectiveParams();
    fetchDataInner(f, t, ao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, from, to, asOn, selCompany, selProject]);

  // Auto-fetch whenever filter params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── expand / collapse ─────────────────────────────────────────────────────
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const expandAll = () => {
    const ids = new Set<number>();
    function collect(n: TBNode) {
      ids.add(n.id);
      n.children.forEach(collect);
    }
    rows.forEach(collect);
    setExpanded(ids);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const displayRows = hideEmpty ? pruneToActive(rows) : rows;
  const visible = flattenVisible(displayRows, expanded, search);
  const balanced = summary
    ? Math.abs(
        summary.openingDebit +
          summary.totalDebit -
          (summary.openingCredit + summary.totalCredit),
      ) < 1
    : false;

  // Export: flat list of all nodes with a depth-indent prefix so groups are legible in PDF/CSV.
  // NOTE: must be a Latin-1 character — jsPDF's built-in Helvetica font only
  // covers Latin-1, and sanitizeForPdf() replaces anything outside that range
  // with "?". The "▸" glyph used here previously was outside Latin-1, so every
  // group name was getting a literal "?" prefix in the exported PDF.
  const exportData = flattenAll(displayRows).map((n) => ({
    ...n,
    name: `${"  ".repeat(n.level)}${n.isGroup ? "> " : ""}${n.name}`,
  })) as unknown as Record<string, unknown>[];

  // Period label for chips + PDF subtitle
  function periodLabel() {
    if (filterMode === "fy" && selectedFY) return selectedFY.FName;
    if (filterMode === "range" && from && to)
      return `${fmtDate(from)} – ${fmtDate(to)}`;
    if (filterMode === "ason" && asOn) return `As On ${fmtDate(asOn)}`;
    return null;
  }

  const exportSubtitle = [
    selEnterprise ? `Enterprise: ${selEnterprise.label}` : null,
    selCompany ? `Company: ${selCompany.label}` : null,
    selProject ? `Project: ${selProject.label}` : null,
    periodLabel() ? `Period: ${periodLabel()}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const statCards = summary
    ? [
        {
          label: "Transaction Debit",
          value: formatINR(summary.totalDebit),
          Icon: TrendingUp,
          color: "text-rose-400",
          bg: "bg-rose-400/10",
          border: "border-l-rose-400",
        },
        {
          label: "Transaction Credit",
          value: formatINR(summary.totalCredit),
          Icon: TrendingDown,
          color: "text-emerald-400",
          bg: "bg-emerald-400/10",
          border: "border-l-emerald-400",
        },
        {
          label: "Net Balance",
          value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)),
          Icon: Scale,
          color: balanced ? "text-emerald-400" : "text-amber-400",
          bg: balanced ? "bg-emerald-400/10" : "bg-amber-400/10",
          border: balanced ? "border-l-emerald-400" : "border-l-amber-400",
        },
        {
          label: "Opening Balance",
          value: formatINR(summary.openingDebit + summary.openingCredit),
          Icon: IndianRupee,
          color: "text-primary",
          bg: "bg-primary/10",
          border: "border-l-primary",
        },
      ]
    : [];

  // PDF stat cards (matches PdfStatCard[] shape)
  const pdfStats = summary
    ? [
        {
          label: "Opening Balance",
          value: formatINR(summary.openingDebit + summary.openingCredit),
        },
        { label: "Transaction Debit", value: formatINR(summary.totalDebit) },
        { label: "Transaction Credit", value: formatINR(summary.totalCredit) },
        {
          label: "Net Balance",
          value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)),
        },
      ]
    : undefined;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Trial Balance"]} />
      <FinanceShell
        title="Trial Balance"
        subtitle={
          asOf
            ? `${visible.length} entries · Refreshed ${fmtDate(asOf)}`
            : "Account-wise opening, transaction and closing balances"
        }
        icon={Scale}
        action={
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={expandAll}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/20 text-muted-foreground hover:text-foreground hover:bg-indigo-500/10 transition-colors"
            >
              <ChevronDown size={13} />
              <span className="hidden sm:inline">Expand All</span>
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/20 text-muted-foreground hover:text-foreground hover:bg-indigo-500/10 transition-colors"
            >
              <ChevronRight size={13} />
              <span className="hidden sm:inline">Collapse</span>
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
              style={{ color: "#818cf8" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >
        {/* ── Main card ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          {/* ── Filter bar ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-4 py-3 border-b border-border bg-muted/20">
            {/* Row 1 — Entity selects + Search + Generate + Export aligned right */}
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect
                label="Enterprise"
                icon={Building}
                value={selEnterprise?.id ?? null}
                onChange={handleEnterpriseChange}
                options={enterprises}
                placeholder="All enterprises"
              />
              <FilterSelect
                label="Company"
                icon={Briefcase}
                value={selCompany?.id ?? null}
                onChange={handleCompanyChange}
                options={companies}
                placeholder="All companies"
              />
              <FilterSelect
                label="Project"
                icon={FolderKanban}
                value={selProject?.id ?? null}
                onChange={(id, opt) => setSelProject(opt)}
                options={projects}
                placeholder="All projects"
              />

              {/* Search + Export — full-width on mobile, auto-right on sm+ */}
              <div className="w-full sm:w-auto sm:ml-auto flex items-end gap-2">
                {/* Hide-empty toggle */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
                    &nbsp;
                  </span>
                  <label className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs bg-background border border-border text-muted-foreground hover:text-foreground cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={!hideEmpty}
                      onChange={(e) => setHideEmpty(!e.target.checked)}
                      className="accent-primary"
                    />
                    Show all accounts
                  </label>
                </div>

                {/* Search */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
                    Search
                  </span>
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      placeholder="Search accounts…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 pl-8 pr-3 w-full sm:w-44 rounded-lg text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                {/* Export */}
                <ExportMenu
                  data={exportData}
                  columns={TB_EXPORT_COLUMNS}
                  title="Trial Balance"
                  filename={`trial-balance-${periodLabel()?.replace(/\s/g, "-").toLowerCase() ?? "report"}`}
                  subtitle={exportSubtitle || undefined}
                  disabled={notReady || rows.length === 0}
                  stats={pdfStats}
                  columnPadding={{
                    0: {
                      cellPadding: { top: 5, bottom: 5, left: 2, right: 6 },
                    },
                  }}
                />
              </div>
            </div>

            {/* Row 2 — Mode selector */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/50 mr-1 shrink-0">
                Filter by:
              </span>
              <ModeTab
                active={filterMode === "fy"}
                onClick={() => switchMode("fy")}
                icon={Calendar}
                label="Financial Year"
              />
              <ModeTab
                active={filterMode === "range"}
                onClick={() => switchMode("range")}
                icon={CalendarRange}
                label="Date Range"
              />
              <ModeTab
                active={filterMode === "ason"}
                onClick={() => switchMode("ason")}
                icon={CalendarCheck}
                label="As On Date"
              />
            </div>

            {/* Row 3 — Period inputs (vary by mode) */}
            <div className="flex flex-wrap items-start gap-3">
              {filterMode === "fy" && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
                    Financial Year
                  </span>
                  <div className="relative">
                    <select
                      value={selectedFYId ?? ""}
                      onChange={(e) =>
                        handleFYChange(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      disabled={finYearsLoading}
                      className="h-8 pl-2.5 pr-7 rounded-lg text-xs bg-background border border-primary/40 ring-1 ring-primary/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none cursor-pointer disabled:opacity-50 min-w-[148px]"
                    >
                      <option value="">
                        {finYearsLoading ? "Loading…" : "Select FY"}
                      </option>
                      {finYears.map((fy) => (
                        <option key={fy.FId} value={fy.FId}>
                          {fy.FName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={11}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {selectedFY && (
                    <span className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {fmtDate(toDateStr(selectedFY.FStartDate))} –{" "}
                      {fmtDate(toDateStr(selectedFY.FEndDate))}
                    </span>
                  )}
                </div>
              )}

              {filterMode === "range" && (
                <>
                  <DateField label="From" value={from} onChange={setFrom} />
                  <DateField label="To" value={to} onChange={setTo} />
                </>
              )}

              {filterMode === "ason" && (
                <>
                  <DateField
                    label="FY Start (opening balance anchor)"
                    value={from}
                    onChange={setFrom}
                  />
                  <DateField
                    label="As On Date"
                    value={asOn}
                    onChange={setAsOn}
                    highlight
                  />
                </>
              )}
            </div>

            {/* Viewing chips */}
            {(selEnterprise || selCompany || selProject || periodLabel()) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">
                  Viewing:
                </span>
                {selEnterprise && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Building size={9} />
                    {selEnterprise.label}
                  </span>
                )}
                {selCompany && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Briefcase size={9} />
                    {selCompany.label}
                  </span>
                )}
                {selProject && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <FolderKanban size={9} />
                    {selProject.label}
                  </span>
                )}
                {periodLabel() && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <CalendarDays size={9} />
                    {periodLabel()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* Stats */}
          {summary && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border border-b border-border">
              {statCards.map(({ label, value, Icon, color, bg, border }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 px-5 py-4 border-l-2 ${border}`}
                >
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={14} />
                  </div>
                  <div>
                    <p
                      className={`text-sm font-bold font-heading leading-none ${color}`}
                    >
                      {value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                      {label}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[38%]">
                    Account / Description
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Opening Balance
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Transactions
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Closing Balance
                  </th>
                </tr>
                <tr className="border-b border-border bg-muted/10">
                  <th className="px-4 py-1.5" />
                  {[
                    "Debit",
                    "Credit",
                    "Debit",
                    "Credit",
                    "Debit",
                    "Credit",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`px-3 py-1.5 text-right text-[10px] font-heading font-medium tracking-wider ${h === "Debit" ? "text-rose-400" : "text-emerald-400"} ${i === 0 ? "border-l border-border/30" : ""} ${i === 1 || i === 3 ? "border-r border-border/30" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border/30">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div
                            className="h-3 rounded bg-muted/60 animate-pulse"
                            style={{
                              width: j === 0 ? `${70 - i * 4}%` : "70%",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-20 text-center text-muted-foreground text-sm"
                    >
                      {rows.length === 0
                        ? loading
                          ? "Loading Trial Balance…"
                          : "No entries found for the selected period."
                        : search
                          ? "No accounts match your search."
                          : "No accounts with activity for this period. Toggle \u201cShow all accounts\u201d to see zero-balance accounts."}
                    </td>
                  </tr>
                ) : (
                  visible.map((node) => (
                    <TBRow
                      key={`${node.isGroup ? "g" : "e"}-${node.id}`}
                      node={node}
                      expanded={expanded}
                      onToggle={toggle}
                    />
                  ))
                )}
              </tbody>

              {summary && !loading && visible.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td className="px-4 py-3 text-xs font-heading font-bold text-foreground uppercase tracking-wider">
                      Grand Total
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400 border-l border-border/30">
                      {formatINR(summary.openingDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">
                      {formatINR(summary.openingCredit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">
                      {formatINR(summary.totalDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">
                      {formatINR(summary.totalCredit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">
                      {formatINR(summary.openingDebit + summary.totalDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400">
                      {formatINR(summary.openingCredit + summary.totalCredit)}
                    </td>
                  </tr>
                  {balanced && (
                    <tr className="bg-emerald-500/5">
                      <td
                        colSpan={7}
                        className="px-4 py-2 text-center text-[11px] font-heading text-emerald-500 font-semibold tracking-wide"
                      >
                        ✓ Books are balanced — Debit = Credit
                      </td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </FinanceShell>
    </>
  );
}
