import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Loader2,
  Receipt,
  X,
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

// ─── Drill-down (Level 2/3) ─────────────────────────────────────────────────
interface TBTransaction {
  entryId: number;
  voucherNo: string | null;
  date: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  sourceType: string | null;
  sourceId: number | null;
  invoiceNo: string | null;
  payment: { id: number; docNo: string | null; mode: string | null; status: string | null } | null;
}

interface TBTransactionsResponse {
  entity: { id: number; name: string; type: string };
  from: string;
  to: string;
  transactions: TBTransaction[];
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
  onDrill,
}: {
  node: TBNode;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onDrill: (node: TBNode) => void;
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
  // Leaf (non-group) rows are clickable — Level 2 of the drill-down opens
  // the transaction list for that entity. Groups already expand/collapse.
  const isDrillable = !node.isGroup;

  return (
    <tr
      onClick={isDrillable ? () => onDrill(node) : undefined}
      className={`border-b border-border/40 transition-colors ${
        node.isGroup
          ? node.level === 0
            ? "bg-muted/35 hover:bg-muted/50"
            : "bg-muted/15 hover:bg-muted/28"
          : "hover:bg-primary/5 cursor-pointer"
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
    <div className={`flex items-center h-8 rounded-lg border text-xs overflow-hidden ${
      highlight ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
    } bg-background`}>
      <span className={`flex items-center gap-1 px-2 h-full border-r text-[9px] font-heading uppercase tracking-wider whitespace-nowrap select-none ${
        highlight ? "border-primary/30 text-primary/70 bg-primary/5" : "border-border text-muted-foreground/60 bg-muted/40"
      }`}>
        <CalendarDays size={10} />
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full px-2 text-xs bg-transparent text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-40 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrialBalance() {
  const rights = usePageRights("trial-balance");
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
  const navigate = useNavigate();

  // ── drill-down (Level 2: entity transactions) ───────────────────────────
  const [drillNode, setDrillNode] = useState<TBNode | null>(null);
  const [drillData, setDrillData] = useState<TBTransactionsResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // ── Level 3: payment detail dialog ───────────────────────────────────────
  const [payDetail, setPayDetail] = useState<Record<string, any> | null>(null);
  const [payDetailLoading, setPayDetailLoading] = useState(false);

  // ── load fin years ────────────────────────────────────────────────────────
  useEffect(() => {
    setFinYearsLoading(true);
    fetchWithAuth("/api/fin-year")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: FinYearRow[]) => {
        // Only unlocked + active fin years are selectable for Trial Balance reporting
        const unlocked = data.filter(
          (f) => !(f.FisLocked === 1 || f.FisLocked === true) && (f.FStatus === 1 || f.FStatus === true),
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
  // Filters narrow the available options but each is independently selectable.
  // Selecting Enterprise scopes the Company list; selecting Company scopes the
  // Project list. But you can also pick a Company or Project without first
  // choosing a parent — the dropdowns just show their full lists in that case.
  function handleEnterpriseChange(id: number | null, opt: Option | null) {
    setSelEnterprise(opt);
    // Narrow child lists but don't force-clear existing selections
    const filteredCompanies = id ? allCompanies.filter((c) => c.enterprise_id === id) : allCompanies;
    setCompanies(filteredCompanies);
    // Only clear company/project if the current selection is no longer in scope
    if (selCompany && id && !filteredCompanies.some((c) => c.id === selCompany.id)) {
      setSelCompany(null);
      setProjects(allProjects);
      setSelProject(null);
    }
  }
  function handleCompanyChange(id: number | null, opt: Option | null) {
    setSelCompany(opt);
    const filteredProjects = id
      ? allProjects.filter((p) => p.company_id === id)
      : selEnterprise
        ? allProjects.filter((p) =>
            allCompanies
              .filter((c) => c.enterprise_id === selEnterprise.id)
              .some((c) => c.id === p.company_id),
          )
        : allProjects;
    setProjects(filteredProjects);
    if (selProject && id && !filteredProjects.some((p) => p.id === selProject.id)) {
      setSelProject(null);
    }
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

  // ── drill-down: Level 1 (ledger) → Level 2 (entity transactions) ─────────
  // Reuses the exact same filters (FY/date range/company/project) the main
  // report is showing, so the transaction list never drifts from what's on
  // screen.
  const openDrillDown = useCallback(
    async (node: TBNode) => {
      setDrillNode(node);
      setDrillData(null);
      setDrillLoading(true);
      try {
        const { f, t, ao } = getEffectiveParams();
        const effectiveTo = ao || t;
        let url = `/api/trial-balance/${node.id}/transactions?from=${f}&to=${effectiveTo}`;
        if (selEnterprise?.id) url += `&enterpriseId=${selEnterprise.id}`;
        if (selCompany?.id) url += `&companyId=${selCompany.id}`;
        if (selProject?.id) url += `&projectId=${selProject.id}`;
        const res = await fetchWithAuth(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setDrillData(await res.json());
      } catch {
        setDrillData(null);
      } finally {
        setDrillLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterMode, from, to, asOn, selCompany, selProject],
  );

  // Level 3 — open detail dialog for a transaction row.
  const openSourceEntry = useCallback(async (t: TBTransaction) => {
    const srcType = (t.sourceType ?? "").toUpperCase();
    const payId = t.payment?.id ?? (srcType === "NEWPAYMENT" ? t.sourceId : null);

    if (payId) {
      // Payment: fetch full detail and show inline dialog
      setPayDetail(null);
      setPayDetailLoading(true);
      try {
        const res = await fetchWithAuth(`/api/new-payment/${payId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPayDetail(await res.json());
      } catch {
        setPayDetail({ _error: true });
      } finally {
        setPayDetailLoading(false);
      }
      return;
    }

    // Other source types — navigate to the relevant page
    if (!t.sourceId) return;
    switch (srcType) {
      case "RECEIVED_PAYMENT":
      case "RECEIPT":
        navigate(`/received-payments?view=${t.sourceId}`); break;
      case "PURCHASE_ORDER":
      case "PO":
        navigate(`/purchase-orders?view=${t.sourceId}`); break;
      case "GRN":
        navigate(`/material/grn?view=${t.sourceId}`); break;
      case "JOURNAL":
      case "JV":
        navigate(`/journal?view=${t.sourceId}`); break;
      default:
        break;
    }
  }, [navigate]);

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
      if (selEnterprise?.id) url += `&enterpriseId=${selEnterprise.id}`;
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
          <div className="flex flex-col gap-3 px-4 py-3.5 border-b border-border bg-muted/20">

            {/* Row 1 — Scope filters: Enterprise / Company / Project (equal columns) */}
            <div className="grid grid-cols-3 gap-3">
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
            </div>

            {/* Row 2 — all period controls on one flat line */}
            <div className="flex flex-wrap items-center gap-2">
              {/* "Filter by" label */}
              <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/50 shrink-0">
                Period:
              </span>

              {/* Mode tabs */}
              <ModeTab active={filterMode === "fy"}    onClick={() => switchMode("fy")}    icon={Calendar}      label="Financial Year" />
              <ModeTab active={filterMode === "range"} onClick={() => switchMode("range")} icon={CalendarRange} label="Date Range" />
              <ModeTab active={filterMode === "ason"}  onClick={() => switchMode("ason")}  icon={CalendarCheck} label="As On Date" />

              {/* Divider */}
              <div className="w-px h-6 bg-border/60 mx-1" />

              {/* Period input inline — no label, the active tab makes it clear */}
              {filterMode === "fy" && (
                <div className="relative">
                  <select
                    value={selectedFYId ?? ""}
                    onChange={(e) => handleFYChange(e.target.value ? Number(e.target.value) : null)}
                    disabled={finYearsLoading}
                    className="h-8 pl-2.5 pr-7 rounded-lg text-xs bg-background border border-primary/40 ring-1 ring-primary/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none cursor-pointer disabled:opacity-50 min-w-[148px]"
                  >
                    <option value="">{finYearsLoading ? "Loading…" : "Select FY"}</option>
                    {finYears.map((fy) => (
                      <option key={fy.FId} value={fy.FId}>{fy.FName}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              )}
              {filterMode === "fy" && selectedFY && (
                <span className="text-[10px] text-muted-foreground/60">
                  {fmtDate(toDateStr(selectedFY.FStartDate))} – {fmtDate(toDateStr(selectedFY.FEndDate))}
                </span>
              )}
              {filterMode === "range" && (
                <>
                  <DateField label="From" value={from} onChange={setFrom} />
                  <DateField label="To"   value={to}   onChange={setTo} />
                </>
              )}
              {filterMode === "ason" && (
                <>
                  <DateField label="FY Start" value={from} onChange={setFrom} />
                  <DateField label="As On"    value={asOn} onChange={setAsOn} highlight />
                </>
              )}

              {/* Push controls to the right */}
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <label className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs bg-background border border-border text-muted-foreground hover:text-foreground cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={!hideEmpty}
                    onChange={(e) => setHideEmpty(!e.target.checked)}
                    className="accent-primary"
                  />
                  Show all accounts
                </label>
                <ExportMenu
                  data={exportData}
                  columns={TB_EXPORT_COLUMNS}
                  title="Trial Balance"
                  filename={`trial-balance-${periodLabel()?.replace(/\s/g, "-").toLowerCase() ?? "report"}`}
                  subtitle={exportSubtitle || undefined}
                  disabled={notReady || rows.length === 0 || !rights.canExport}
                  stats={pdfStats}
                  columnPadding={{ 0: { cellPadding: { top: 5, bottom: 5, left: 2, right: 6 } } }}
                />
              </div>
            </div>

            {/* Viewing chips */}
            {(selEnterprise || selCompany || selProject || periodLabel()) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Viewing:</span>
                {selEnterprise && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Building size={9} /> {selEnterprise.label}
                  </span>
                )}
                {selCompany && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Briefcase size={9} /> {selCompany.label}
                  </span>
                )}
                {selProject && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <FolderKanban size={9} /> {selProject.label}
                  </span>
                )}
                {periodLabel() && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <CalendarDays size={9} /> {periodLabel()}
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
                  <th className="px-4 py-2 text-left w-[38%]">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                        Account / Description
                      </span>
                      <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="h-6 pl-6 pr-5 rounded-md text-[11px] bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 w-36"
                        />
                        {search && (
                          <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </div>
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
                        ? "No entries found for the selected period."
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
                      onDrill={openDrillDown}
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

      {/* ── Level 3: Payment detail dialog ─────────────────────────────────── */}
      <Dialog open={!!payDetail || payDetailLoading} onOpenChange={(o) => { if (!o) setPayDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20">
                <IndianRupee size={15} className="text-primary" />
              </div>
              <div>
                <DialogTitle className="font-heading text-base">
                  {payDetailLoading ? "Loading…" : payDetail?.DocNo ?? "Payment Detail"}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {payDetail?.Status ?? ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          {payDetailLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Fetching payment…
            </div>
          ) : payDetail?._error ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Could not load payment details.</div>
          ) : payDetail ? (
            <div className="space-y-4">
              {/* Amount highlight */}
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-heading uppercase tracking-wide">Amount Paid</span>
                <span className="text-xl font-bold text-primary font-heading">{formatINR(Number(payDetail.PAmount) || 0)}</span>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  { label: "Payee / Supplier",  value: payDetail.PSupplierName || payDetail.PPaymentName },
                  { label: "Payment Date",       value: payDetail.PDate ? fmtDate(String(payDetail.PDate).slice(0, 10)) : "—" },
                  { label: "Mode",               value: payDetail.PMode || "—" },
                  { label: "Bank",               value: payDetail.BankAccountName || payDetail.PBankName || "—" },
                  { label: "Cheque / Ref No.",   value: payDetail.PChequeNo || "—" },
                  { label: "Cheque Date",        value: payDetail.PChequeDate ? fmtDate(String(payDetail.PChequeDate).slice(0, 10)) : "—" },
                  { label: "Company",            value: payDetail.PCompanyName || "—" },
                  { label: "Project",            value: payDetail.PProjectName || "—" },
                  { label: "Expense Booking",    value: payDetail.RefDoc || "—" },
                  { label: "EB Date",            value: payDetail.EBDocDate ? fmtDate(String(payDetail.EBDocDate).slice(0, 10)) : "—" },
                  { label: "Taxable Amount",     value: payDetail.TaxableAmount ? formatINR(Number(payDetail.TaxableAmount)) : "—" },
                  { label: "Tax Amount",         value: payDetail.TaxAmount ? formatINR(Number(payDetail.TaxAmount)) : "—" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-0.5">{label}</p>
                    <p className="text-foreground font-medium truncate">{value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Description */}
              {payDetail.EBDescription && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Description</p>
                  <p className="text-xs text-foreground">{payDetail.EBDescription}</p>
                </div>
              )}

              {/* Narration / remarks */}
              {payDetail.PRemarks && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Remarks</p>
                  <p className="text-xs text-foreground">{payDetail.PRemarks}</p>
                </div>
              )}

              {/* Card info */}
              {payDetail.PCardNumber && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-xs">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Card</p>
                  <p>{payDetail.PCardHolderName} · {payDetail.PCardNetwork} ···· {String(payDetail.PCardNumber).slice(-4)}</p>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Drill-down dialog — Level 2: entity transactions, Level 3: open receipt ── */}
      <Dialog open={!!drillNode} onOpenChange={(open) => !open && setDrillNode(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20">
                <Receipt size={16} className="text-primary" />
              </div>
              <div>
                <DialogTitle className="font-heading text-base">{drillNode?.name}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {drillNode?.type ? TYPE_LABEL[drillNode.type] ?? drillNode.type : ""} · transactions in the selected period
                </p>
              </div>
            </div>
          </DialogHeader>

          {drillLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading transactions...
            </div>
          ) : !drillData || drillData.transactions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No transactions found for this entity in the selected period.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground uppercase text-[10px] tracking-wide">
                    <th className="px-3 py-2">Voucher No.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Source / Entry</th>
                    <th className="px-3 py-2">Invoice No.</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                    <th className="px-3 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {drillData.transactions.map((t) => (
                    <tr
                      key={t.entryId}
                      onClick={() => (t.sourceId || t.payment) && openSourceEntry(t)}
                      className={`border-b border-border/40 ${(t.sourceId || t.payment) ? "cursor-pointer hover:bg-primary/5" : ""}`}
                      title={(t.sourceId || t.payment) ? "Open source entry" : undefined}
                    >
                      <td className="px-3 py-2 font-mono">{t.voucherNo || "—"}</td>
                      <td className="px-3 py-2">{t.date ? fmtDate(t.date) : "—"}</td>
                      <td className="px-3 py-2">
                        {t.sourceId ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                              {t.sourceType ?? "entry"}
                            </span>
                            <span className="text-primary font-medium underline">
                              {t.payment?.docNo || `#${t.sourceId}`}
                            </span>
                          </span>
                        ) : t.payment ? (
                          <span className="text-primary font-medium underline">{t.payment.docNo || `#${t.payment.id}`}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">{t.invoiceNo || "—"}</td>
                      <td className="px-3 py-2">{t.payment?.mode || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-400">{fmt(t.debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{fmt(t.credit)}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{t.narration || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
