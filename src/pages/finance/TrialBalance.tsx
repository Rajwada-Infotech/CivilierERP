import { useState, useCallback, useRef, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalancePair { debit: number; credit: number; }

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
  totalDebit: number; totalCredit: number;
  openingDebit: number; openingCredit: number;
}

interface TBResponse {
  rows: TBNode[]; summary: TBSummary; asOf: string; from: string; to: string;
}

interface Option { id: number; label: string; belongs_to?: string; company_id?: number; enterprise_id?: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => (n === 0 ? "—" : formatINR(n));

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function getFinancialYears(count = 7) {
  const now = new Date();
  const cur = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = cur - i;
    return { label: `FY ${y}-${String(y + 1).slice(2)}`, from: `${y}-04-01`, to: `${y + 1}-03-31` };
  });
}

const FY_OPTIONS = getFinancialYears();

const TYPE_DOT: Record<string, string> = {
  S: "bg-blue-400", C: "bg-orange-400", B: "bg-emerald-400", A: "bg-purple-400", GL: "bg-primary/70",
};
const TYPE_LABEL: Record<string, string> = {
  S: "Supplier", C: "Contractor", B: "Bank", A: "Customer", GL: "GL",
};

// ─── Flatten visible ──────────────────────────────────────────────────────────

function flattenVisible(nodes: TBNode[], expanded: Set<number>, search: string): TBNode[] {
  const result: TBNode[] = [];
  const q = search.toLowerCase();

  function hasMatch(n: TBNode): boolean {
    if (!q) return true;
    if (n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q)) return true;
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

// ─── TBRow ────────────────────────────────────────────────────────────────────

function TBRow({ node, expanded, onToggle }: { node: TBNode; expanded: Set<number>; onToggle: (id: number) => void }) {
  const isOpen   = expanded.has(node.id);
  const hasKids  = node.children.length > 0;
  const indent   = node.level * 20;

  const hasAnyValue =
    node.opening.debit > 0 || node.opening.credit > 0 ||
    node.transactions.debit > 0 || node.transactions.credit > 0;

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

          {/* Expand/collapse for groups; spacer for entities */}
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

          {/* Group: folder icon; Entity: colored type dot */}
          {node.isGroup ? (
            <span className="shrink-0 text-amber-400/80">
              {isOpen && hasKids ? <FolderOpen size={13} /> : <Folder size={13} />}
            </span>
          ) : dot ? (
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          ) : (
            <span className="w-2 shrink-0" />
          )}

          {/* Name */}
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
            <span className="text-[10px] font-mono text-muted-foreground/50">{node.code}</span>
          )}

          {!node.isGroup && node.type && (
            <span className="text-[9px] font-heading uppercase tracking-wider text-muted-foreground/40">
              {TYPE_LABEL[node.type] ?? node.type}
            </span>
          )}

          {!node.isGroup && !hasAnyValue && (
            <span className="text-[10px] text-muted-foreground/35 italic ml-0.5">no transactions</span>
          )}
        </div>
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-l border-border/30">{fmt(node.opening.debit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">{fmt(node.opening.credit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground">{fmt(node.transactions.debit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">{fmt(node.transactions.credit)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.debit  > 0 ? "text-rose-400"    : "text-muted-foreground/35"}`}>{fmt(node.closing.debit)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.credit > 0 ? "text-emerald-400" : "text-muted-foreground/35"}`}>{fmt(node.closing.credit)}</td>
    </tr>
  );
}

// ─── Simple select dropdown ───────────────────────────────────────────────────

function FilterSelect({
  label, icon: Icon, value, onChange, options, placeholder, loading: isLoading,
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
    <div className="flex flex-col gap-0.5 min-w-[140px]">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
        <Icon size={9} /> {label}
      </span>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange(id, id ? (options.find((o) => o.id === id) ?? null) : null);
          }}
          disabled={isLoading}
          className="h-8 w-full pl-2.5 pr-7 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none disabled:opacity-50 cursor-pointer"
        >
          <option value="">{isLoading ? "Loading…" : placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrialBalance() {
  const fy0 = FY_OPTIONS[0];

  // ── date / period state ────────────────────────────────────────────────────
  const [selectedFY, setSelectedFY]   = useState(fy0.label);
  const [from,       setFrom]         = useState(fy0.from);
  const [to,         setTo]           = useState(fy0.to);
  const [asOn,       setAsOn]         = useState("");

  // ── enterprise / company / project ────────────────────────────────────────
  const [enterprises,   setEnterprises]   = useState<Option[]>([]);
  const [companies,     setCompanies]     = useState<Option[]>([]);
  const [projects,      setProjects]      = useState<Option[]>([]);
  const [allCompanies,  setAllCompanies]  = useState<Option[]>([]);
  const [allProjects,   setAllProjects]   = useState<Option[]>([]);

  const [selEnterprise, setSelEnterprise] = useState<Option | null>(null);
  const [selCompany,    setSelCompany]    = useState<Option | null>(null);
  const [selProject,    setSelProject]    = useState<Option | null>(null);

  // ── data state ────────────────────────────────────────────────────────────
  const [rows,     setRows]     = useState<TBNode[]>([]);
  const [summary,  setSummary]  = useState<TBSummary | null>(null);
  const [asOf,     setAsOf]     = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search,   setSearch]   = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // ── fetch options on mount ────────────────────────────────────────────────
  useEffect(() => {
    async function loadOptions() {
      try {
        const [eRes, cRes, pRes] = await Promise.all([
          fetchWithAuth("/api/enterprises/options?business_type=E"),
          fetchWithAuth("/api/enterprises/options?business_type=C"),
          fetchWithAuth("/api/enterprises/options?business_type=P"),
        ]);
        if (eRes.ok) setEnterprises(await eRes.json());
        if (cRes.ok) { const d = await cRes.json(); setAllCompanies(d); setCompanies(d); }
        if (pRes.ok) { const d = await pRes.json(); setAllProjects(d);  setProjects(d);  }
      } catch { /* silent */ }
    }
    loadOptions();
  }, []);

  // ── cascade enterprise → companies ────────────────────────────────────────
  function handleEnterpriseChange(id: number | null, opt: Option | null) {
    setSelEnterprise(opt);
    setSelCompany(null);
    setSelProject(null);
    setCompanies(id ? allCompanies.filter((c) => c.enterprise_id === id) : allCompanies);
    setProjects(allProjects);
  }

  // ── cascade company → projects ────────────────────────────────────────────
  function handleCompanyChange(id: number | null, opt: Option | null) {
    setSelCompany(opt);
    setSelProject(null);
    setProjects(id ? allProjects.filter((p) => p.company_id === id) : (selEnterprise ? allProjects.filter((p) => allCompanies.filter((c) => c.enterprise_id === selEnterprise.id).some((c) => c.id === p.company_id)) : allProjects));
  }

  // ── FY selection ──────────────────────────────────────────────────────────
  function handleFYChange(label: string) {
    setSelectedFY(label);
    const opt = FY_OPTIONS.find((o) => o.label === label);
    if (opt) { setFrom(opt.from); setTo(opt.to); setAsOn(""); }
  }

  // ── fetch data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (f = from, t = to, ao = asOn) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const effectiveTo = ao || t;
      let url = `/api/trial-balance?from=${f}&to=${effectiveTo}`;
      if (selCompany?.id)  url += `&companyId=${selCompany.id}`;
      if (selProject?.id)  url += `&projectId=${selProject.id}`;

      const res = await fetchWithAuth(url, { signal: abortRef.current.signal });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, asOn, selCompany, selProject]);

  useEffect(() => { fetchData(fy0.from, fy0.to, ""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── expand / collapse ─────────────────────────────────────────────────────
  const toggle = (id: number) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const expandAll = () => {
    const ids = new Set<number>();
    function collect(n: TBNode) { ids.add(n.id); n.children.forEach(collect); }
    rows.forEach(collect);
    setExpanded(ids);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const visible  = flattenVisible(rows, expanded, search);
  const balanced = summary
    ? Math.abs((summary.openingDebit + summary.totalDebit) - (summary.openingCredit + summary.totalCredit)) < 1
    : false;

  const statCards = summary ? [
    { label: "Transaction Debit",  value: formatINR(summary.totalDebit),   Icon: TrendingUp,   color: "text-rose-400",    bg: "bg-rose-400/10",    border: "border-l-rose-400" },
    { label: "Transaction Credit", value: formatINR(summary.totalCredit),  Icon: TrendingDown, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-l-emerald-400" },
    { label: "Net Balance",        value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)), Icon: Scale, color: balanced ? "text-emerald-400" : "text-amber-400", bg: balanced ? "bg-emerald-400/10" : "bg-amber-400/10", border: balanced ? "border-l-emerald-400" : "border-l-amber-400" },
    { label: "Opening Balance",    value: formatINR(summary.openingDebit + summary.openingCredit), Icon: IndianRupee, color: "text-primary", bg: "bg-primary/10", border: "border-l-primary" },
  ] : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Transactions"]} />
      <div className="space-y-6 mt-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">Trial Balance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {asOf ? `${visible.length} entries · Refreshed ${fmtDate(asOf)}` : "Account-wise opening, transaction and closing balances"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={expandAll} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Expand All</button>
            <button onClick={() => setExpanded(new Set(rows.map((r) => r.id)))} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Collapse</button>
            <button onClick={() => fetchData()} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Main card ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">

          {/* Filter bar */}
          <div className="flex flex-col gap-3 px-4 py-3 border-b border-border bg-muted/20">

            {/* Row 1 — Entity scope */}
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect
                label="Enterprise" icon={Building}
                value={selEnterprise?.id ?? null}
                onChange={handleEnterpriseChange}
                options={enterprises}
                placeholder="All enterprises"
              />
              <FilterSelect
                label="Company" icon={Briefcase}
                value={selCompany?.id ?? null}
                onChange={handleCompanyChange}
                options={companies}
                placeholder="All companies"
              />
              <FilterSelect
                label="Project" icon={FolderKanban}
                value={selProject?.id ?? null}
                onChange={(id, opt) => setSelProject(opt)}
                options={projects}
                placeholder="All projects"
              />

              {/* Search */}
              <div className="ml-auto flex flex-col gap-0.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">Search</span>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="text" placeholder="Search accounts…" value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-8 pr-3 w-44 rounded-lg text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            </div>

            {/* Row 2 — Period */}
            <div className="flex flex-wrap items-end gap-3">

              {/* Financial Year */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">Financial Year</span>
                <div className="relative">
                  <select
                    value={selectedFY}
                    onChange={(e) => handleFYChange(e.target.value)}
                    className="h-8 pl-2.5 pr-7 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
                  >
                    {FY_OPTIONS.map((o) => (
                      <option key={o.label} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              <div className="w-px h-8 bg-border/60 self-end" />

              {/* Date range */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">From</span>
                <div className="relative">
                  <CalendarDays size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
                  <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSelectedFY("Custom"); }}
                    className="h-8 pl-8 pr-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">To</span>
                <div className="relative">
                  <CalendarDays size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
                  <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setAsOn(""); setSelectedFY("Custom"); }}
                    className="h-8 pl-8 pr-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>

              <div className="w-px h-8 bg-border/60 self-end" />

              {/* As On */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
                  As On {asOn && <span className="normal-case text-primary">(active)</span>}
                </span>
                <div className="relative">
                  <CalendarDays size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
                  <input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)}
                    className={`h-8 pl-8 pr-2 rounded-lg text-xs bg-background border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${
                      asOn ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
                    }`} />
                </div>
              </div>
              {asOn && (
                <button onClick={() => setAsOn("")} className="self-end h-8 px-2.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground border border-border hover:bg-muted transition-colors">
                  Clear
                </button>
              )}

              <button
                onClick={() => fetchData(from, to, asOn)}
                disabled={loading}
                className="self-end h-8 px-5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white disabled:opacity-50 ml-1"
              >
                {loading ? "Loading…" : "Generate"}
              </button>
            </div>

            {/* Active scope label */}
            {(selEnterprise || selCompany || selProject || asOn) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Viewing:</span>
                {selEnterprise && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading"><Building size={9} />{selEnterprise.label}</span>}
                {selCompany    && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading"><Briefcase size={9} />{selCompany.label}</span>}
                {selProject    && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading"><FolderKanban size={9} />{selProject.label}</span>}
                {asOn          && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading"><CalendarDays size={9} />As On {fmtDate(asOn)}</span>}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">{error}</div>
          )}

          {/* Stats */}
          {summary && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border border-b border-border">
              {statCards.map(({ label, value, Icon, color, bg, border }) => (
                <div key={label} className={`flex items-center gap-3 px-5 py-4 border-l-2 ${border}`}>
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}><Icon size={14} /></div>
                  <div>
                    <p className={`text-sm font-bold font-heading leading-none ${color}`}>{value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">{label}</p>
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
                  <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40">Opening Balance</th>
                  <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40">Transactions</th>
                  <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40">Closing Balance</th>
                </tr>
                <tr className="border-b border-border bg-muted/10">
                  <th className="px-4 py-1.5" />
                  {["Debit","Credit","Debit","Credit","Debit","Credit"].map((h, i) => (
                    <th key={i} className={`px-3 py-1.5 text-right text-[10px] font-heading font-medium tracking-wider ${h === "Debit" ? "text-rose-400" : "text-emerald-400"} ${i === 0 ? "border-l border-border/30" : ""} ${i === 1 || i === 3 ? "border-r border-border/30" : ""}`}>
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
                          <div className="h-3 rounded bg-muted/60 animate-pulse" style={{ width: j === 0 ? `${70 - i * 4}%` : "70%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-20 text-center text-muted-foreground text-sm">
                      {rows.length === 0 ? "Click Generate to view the Trial Balance." : "No accounts match your search."}
                    </td>
                  </tr>
                ) : (
                  visible.map((node) => (
                    <TBRow key={`${node.isGroup ? "g" : "e"}-${node.id}`} node={node} expanded={expanded} onToggle={toggle} />
                  ))
                )}
              </tbody>

              {summary && !loading && visible.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td className="px-4 py-3 text-xs font-heading font-bold text-foreground uppercase tracking-wider">Grand Total</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400 border-l border-border/30">{formatINR(summary.openingDebit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">{formatINR(summary.openingCredit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">{formatINR(summary.totalDebit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">{formatINR(summary.totalCredit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">{formatINR(summary.openingDebit + summary.totalDebit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400">{formatINR(summary.openingCredit + summary.totalCredit)}</td>
                  </tr>
                  {balanced && (
                    <tr className="bg-emerald-500/5">
                      <td colSpan={7} className="px-4 py-2 text-center text-[11px] font-heading text-emerald-500 font-semibold tracking-wide">
                        ✓ Books are balanced — Debit = Credit
                      </td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </div>

      </div>
    </>
  );
}
