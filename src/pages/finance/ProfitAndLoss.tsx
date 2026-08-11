import { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { RefreshCw, CalendarDays, Building, FolderKanban, TrendingUp, Loader2 } from "lucide-react";

interface Option {
  id: number;
  label: string;
}

interface StatementGroup {
  groupId: number | string;
  groupName: string;
  heads: { id: number | null; name: string; amount: number }[];
  total: number;
}

interface ProfitLossResponse {
  from: string;
  to: string;
  income: StatementGroup[];
  expenses: StatementGroup[];
  totals: { income: number; expenses: number; netProfit: number };
}

const fmt = (n: number) => formatINR(Math.abs(n));

function ColumnSide({
  title,
  groups,
  total,
  accent,
}: {
  title: string;
  groups: StatementGroup[];
  total: number;
  accent: "rose" | "emerald";
}) {
  const accentCls = accent === "rose" ? "text-rose-400" : "text-emerald-400";
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
        <h3 className="text-xs font-heading font-semibold uppercase tracking-widest text-foreground">
          {title}
        </h3>
      </div>
      <div className="divide-y divide-border/40">
        {groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground italic">
            No entries for this period.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.groupId} className="px-4 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{g.groupName}</span>
                <span className={`text-xs font-bold tabular-nums ${accentCls}`}>
                  {fmt(g.total)}
                </span>
              </div>
              <div className="mt-1 space-y-0.5 pl-2">
                {g.heads.map((h) => (
                  <div
                    key={h.id ?? h.name}
                    className="flex items-center justify-between text-[11px] text-muted-foreground"
                  >
                    <span className="truncate pr-2">{h.name}</span>
                    <span className="tabular-nums shrink-0">{fmt(h.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className={`flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20 text-sm font-bold font-heading ${accentCls}`}>
        <span>Total</span>
        <span className="tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}

export default function ProfitAndLoss() {
  const rights = usePageRights("profit-and-loss");
  const now = new Date();
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${fyYear}-04-01`);
  const [to, setTo] = useState(`${fyYear + 1}-03-31`);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [data, setData] = useState<ProfitLossResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json())
      .then((d) => setCompanies(Array.isArray(d) ? d : []))
      .catch(() => setCompanies([]));
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => setProjects([]));
  }, []);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, to });
    if (companyId) qs.set("companyId", String(companyId));
    if (projectId) qs.set("projectId", String(projectId));
    fetchWithAuth(`/api/financial-statements/profit-loss?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, companyId, projectId]);

  const exportColumns: ExportColumn[] = [
    { header: "Side", accessor: "side" },
    { header: "Group", accessor: "group" },
    { header: "Head", accessor: "head" },
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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Profit & Loss"]} />
      <FinanceShell title="Profit & Loss" subtitle="Income and Expenditure for a given period" icon={TrendingUp}>
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
              <CalendarDays size={9} /> From
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
              <CalendarDays size={9} /> To
            </span>
            <input
              type="date"
              value={to}
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
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
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
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={fetchData}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {rights.canExport && data && (
            <ExportMenu title="Profit & Loss" filename="profit-and-loss" columns={exportColumns} data={exportRows} />
          )}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={16} /> Loading profit & loss…
          </div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-red-500">{error}</div>
        ) : data ? (
          <>
            <div className="flex flex-col lg:flex-row gap-4">
              <ColumnSide title="Expenditure" groups={data.expenses} total={data.totals.expenses} accent="rose" />
              <ColumnSide title="Income" groups={data.income} total={data.totals.income} accent="emerald" />
            </div>
            <div
              className={`mt-4 flex items-center justify-between px-4 py-2.5 rounded-lg text-xs font-heading font-semibold tracking-wide ${
                data.totals.netProfit >= 0
                  ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-500"
                  : "bg-rose-500/5 border border-rose-500/20 text-rose-500"
              }`}
            >
              <span>{data.totals.netProfit >= 0 ? "Net Profit" : "Net Loss"} for the period</span>
              <span className="tabular-nums">{formatINR(Math.abs(data.totals.netProfit))}</span>
            </div>
          </>
        ) : null}
      </FinanceShell>
    </>
  );
}
