import React, { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SummaryCards } from "@/components/reports/SummaryCards";
import { IncomeVsExpenseChart } from "@/components/reports/IncomeVsExpenseChart";
import { ExpenseByCategoryChart } from "@/components/reports/ExpenseByCategoryChart";
import { CashFlowChart } from "@/components/reports/CashFlowChart";
import { TopPartiesTable } from "@/components/reports/TopPartiesTable";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { getCompanyById } from "@/api/enterpriseApi";
import {
  Building2,
  Calendar,
  CalendarRange,
  ChevronDown,
  Filter,
  RefreshCw,
  X,
  TrendingUp,
  BarChart3,
  SlidersHorizontal,
} from "lucide-react";

interface ReportsSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  transactionCount: number;
}
interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
}
interface CategoryPoint {
  name: string;
  value: number;
  color: string;
}
interface CashFlowPoint {
  month: string;
  balance: number;
}
interface TopParty {
  name: string;
  txns: number;
  total: number;
}
interface ReportsData {
  summary: ReportsSummary;
  filters: {
    companyId: string | null;
    mode: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    finYearLabel: string | null;
  };
  charts: {
    monthly: MonthlyPoint[];
    categories: CategoryPoint[];
    cashFlow: CashFlowPoint[];
  };
  topParties: TopParty[];
}
interface CompanyOption {
  id: number;
  name: string;
}
interface FinYearOption {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus: string;
}
type DateMode = "single" | "range";
type FinYearGranularity = "year" | "month" | "day";

const fmt = (n: number) =>
  "Rs." +
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(n);

const FilterChip: React.FC<{ label: string; onRemove: () => void }> = ({
  label,
  onRemove,
}) => (
  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary border border-primary/20">
    {label}
    <button
      onClick={onRemove}
      className="hover:text-destructive transition-colors"
    >
      <X size={10} />
    </button>
  </span>
);

const StyledSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
  className?: string;
}> = ({ value, onChange, placeholder, options, icon, className = "" }) => (
  <div className={`relative ${className}`}>
    {icon && (
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10">
        {icon}
      </span>
    )}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full appearance-none rounded-lg border border-border bg-card text-foreground text-sm py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${icon ? "pl-9" : "pl-3"}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown
      size={14}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
    />
  </div>
);

const Reports: React.FC = () => {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [finYears, setFinYears] = useState<FinYearOption[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [dateMode, setDateMode] = useState<DateMode>("single");
  const [singleDate, setSingleDate] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [finYearId, setFinYearId] = useState("");
  const [fyGranularity, setFyGranularity] =
    useState<FinYearGranularity>("year");
  const [fyMonth, setFyMonth] = useState("");
  const [fyDay, setFyDay] = useState("");

  // Fetch full company detail (name + logo) for export when a company is filtered
  const { data: selectedCompanyDetail = null } = useQuery({
    queryKey: ["company-detail-reports", companyId],
    queryFn: () => (companyId ? getCompanyById(Number(companyId)) : Promise.resolve(null)),
    enabled: !!companyId,
  });

  useEffect(() => {
    fetchWithAuth("/api/reports/companies")
      .then((r) => r.json())
      .then((l: CompanyOption[]) => setCompanies(Array.isArray(l) ? l : []))
      .catch(() => {});
    fetchWithAuth("/api/fin-year")
      .then((r) => r.json())
      .then((l: FinYearOption[]) => setFinYears(Array.isArray(l) ? l : []))
      .catch(() => {});
  }, []);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (companyId) p.set("companyId", companyId);
    if (finYearId) {
      const fy = finYears.find((f) => String(f.FId) === finYearId);
      if (fy) {
        if (fyGranularity === "year") {
          p.set("mode", "finYear");
          p.set("finYearId", finYearId);
        } else if (fyGranularity === "month" && fyMonth) {
          const startYear = fy.FStartDate?.slice(0, 4) ?? "";
          const yr =
            fyMonth <= "03" ? String(parseInt(startYear) + 1) : startYear;
          p.set("mode", "month");
          p.set("dateFrom", `${yr}-${fyMonth}`);
        } else if (fyGranularity === "day" && fyDay) {
          p.set("mode", "day");
          p.set("dateFrom", fyDay);
        }
      }
    } else {
      if (dateMode === "single" && singleDate) {
        p.set("mode", "single");
        p.set("dateFrom", singleDate);
      } else if (dateMode === "range" && rangeFrom && rangeTo) {
        p.set("mode", "range");
        p.set("dateFrom", rangeFrom);
        p.set("dateTo", rangeTo);
      }
    }
    return p.toString();
  }, [
    companyId,
    dateMode,
    singleDate,
    rangeFrom,
    rangeTo,
    finYearId,
    fyGranularity,
    fyMonth,
    fyDay,
    finYears,
  ]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = buildParams();
    fetchWithAuth(`/api/reports${qs ? `?${qs}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load reports");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearAll = () => {
    setCompanyId("");
    setSingleDate("");
    setRangeFrom("");
    setRangeTo("");
    setFinYearId("");
    setFyGranularity("year");
    setFyMonth("");
    setFyDay("");
  };

  const activeChips: { label: string; clear: () => void }[] = [];
  if (companyId) {
    const c = companies.find((x) => String(x.id) === companyId);
    if (c) activeChips.push({ label: c.name, clear: () => setCompanyId("") });
  }
  if (finYearId) {
    const fy = finYears.find((f) => String(f.FId) === finYearId);
    if (fy) {
      let label = fy.FName;
      if (fyGranularity === "month" && fyMonth) label += ` · Month ${fyMonth}`;
      if (fyGranularity === "day" && fyDay) label += ` · ${fyDay}`;
      activeChips.push({
        label,
        clear: () => {
          setFinYearId("");
          setFyGranularity("year");
          setFyMonth("");
          setFyDay("");
        },
      });
    }
  } else {
    if (dateMode === "single" && singleDate)
      activeChips.push({ label: singleDate, clear: () => setSingleDate("") });
    if (dateMode === "range" && rangeFrom && rangeTo)
      activeChips.push({
        label: `${rangeFrom} → ${rangeTo}`,
        clear: () => {
          setRangeFrom("");
          setRangeTo("");
        },
      });
  }

  const selectedFY = finYears.find((f) => String(f.FId) === finYearId);

  const TOP_PARTIES_COLUMNS: ExportColumn[] = [
    { header: "Party Name", accessor: "name" },
    { header: "Transactions", accessor: "txns" },
    { header: "Total (Rs.)", accessor: (r) => fmt(Number(r.total)) },
  ];

  // ── Summary section: key metrics ──────────────────────────────────────────
  const SUMMARY_COLUMNS: ExportColumn[] = [
    { header: "Metric", accessor: "metric" },
    { header: "Value", accessor: "value" },
  ];
  const summaryRows: Record<string, unknown>[] = data
    ? [
        { metric: "Total Income", value: fmt(data.summary.totalIncome) },
        { metric: "Total Expenses", value: fmt(data.summary.totalExpenses) },
        { metric: "Net Profit", value: fmt(data.summary.netProfit) },
        { metric: "Total Transactions", value: String(data.summary.transactionCount) },
      ]
    : [];

  // ── Monthly breakdown: proper columns ─────────────────────────────────────
  const MONTHLY_COLUMNS: ExportColumn[] = [
    { header: "Month", accessor: "month" },
    { header: "Income (Rs.)", accessor: "income" },
    { header: "Expense (Rs.)", accessor: "expense" },
    { header: "Net (Rs.)", accessor: "net" },
  ];
  const monthlyRows: Record<string, unknown>[] = data
    ? data.charts.monthly.map((m) => ({
        month: m.month,
        income: fmt(m.income),
        expense: fmt(m.expense),
        net: fmt(m.income - m.expense),
      }))
    : [];

  // ── Top parties: formatted totals ─────────────────────────────────────────
  const topPartiesRows: Record<string, unknown>[] = data
    ? data.topParties.map((p) => ({ name: p.name, txns: p.txns, total: p.total }))
    : [];

  return (
    <div className="flex flex-col min-h-0">
      <Breadcrumbs items={["Dashboard", "Reports"]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <BarChart3 size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground leading-tight">
              Reports
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {activeChips.length > 0 ? "Filtered view" : "All-time overview"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <ExportMenu
                data={summaryRows}
                columns={SUMMARY_COLUMNS}
                title="Financial Summary"
                filename="reports-summary"
                subtitle={`Income: ${fmt(data.summary.totalIncome)} · Expenses: ${fmt(data.summary.totalExpenses)} · Net: ${fmt(data.summary.netProfit)}`}
                companyName={selectedCompanyDetail?.name ?? undefined}
                logoBase64={selectedCompanyDetail?.logo ?? undefined}
              />
              <ExportMenu
                data={monthlyRows}
                columns={MONTHLY_COLUMNS}
                title="Monthly Breakdown"
                filename="reports-monthly"
                disabled={monthlyRows.length === 0}
                companyName={selectedCompanyDetail?.name ?? undefined}
                logoBase64={selectedCompanyDetail?.logo ?? undefined}
              />
            </>
          )}
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all
              ${sidebarOpen ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary/40"}`}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filters</span>
            {activeChips.length > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/20 text-[10px] font-bold">
                {activeChips.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Top filter bar */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Company */}
          <div className="flex-1 min-w-[200px] max-w-[260px]">
            <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Company
            </label>
            <StyledSelect
              value={companyId}
              onChange={setCompanyId}
              placeholder="All Companies"
              icon={<Building2 size={13} />}
              options={companies.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
          </div>

          {/* Date mode tabs */}
          <div className="flex-1 min-w-[200px] max-w-[240px]">
            <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Date Filter
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden bg-muted/30">
              {(["single", "range"] as DateMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setDateMode(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all
                    ${dateMode === m && !finYearId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "single" ? (
                    <Calendar size={12} />
                  ) : (
                    <CalendarRange size={12} />
                  )}
                  {m === "single" ? "Single Day" : "Date Range"}
                </button>
              ))}
            </div>
          </div>

          {/* Date inputs */}
          <div className="flex items-end gap-2 flex-1 min-w-[180px]">
            {dateMode === "single" ? (
              <div className="flex-1">
                <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  disabled={!!finYearId}
                  className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                />
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    From
                  </label>
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    disabled={!!finYearId}
                    className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    To
                  </label>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    disabled={!!finYearId}
                    className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                  />
                </div>
              </>
            )}
          </div>

          {/* Apply / Reset */}
          <div className="flex items-end gap-2 pb-0.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-all"
            >
              <Filter size={13} /> Apply
            </button>
            {activeChips.length > 0 && (
              <button
                onClick={() => {
                  clearAll();
                  setTimeout(loadData, 0);
                }}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
              >
                <RefreshCw size={13} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Active chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider">
              Active:
            </span>
            {activeChips.map((c) => (
              <FilterChip
                key={c.label}
                label={c.label}
                onRemove={() => {
                  c.clear();
                  setTimeout(loadData, 0);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content + Sidebar */}
      <div className="flex gap-4 items-start">
        {/* Charts */}
        <div className="flex-1 min-w-0 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={24} className="animate-spin opacity-50" />
                <span className="text-sm">Loading reports…</span>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="text-destructive text-sm">{error}</p>
              <button
                onClick={loadData}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !error && data && (
            <>
              <SummaryCards summary={data.summary} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <IncomeVsExpenseChart data={data.charts.monthly} />
                <ExpenseByCategoryChart data={data.charts.categories} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <CashFlowChart data={data.charts.cashFlow} />
                <div className="relative">
                  <TopPartiesTable parties={data.topParties} />
                  <div className="absolute top-4 right-4">
                    <ExportMenu
                      data={topPartiesRows}
                      columns={TOP_PARTIES_COLUMNS}
                      title="Top Parties by Volume"
                      filename="top-parties"
                      disabled={topPartiesRows.length === 0}
                      companyName={selectedCompanyDetail?.name ?? undefined}
                      logoBase64={selectedCompanyDetail?.logo ?? undefined}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-60 shrink-0 rounded-xl border border-border bg-card overflow-hidden sticky top-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                <Filter size={12} /> Financial Year
              </div>
              {finYearId && (
                <button
                  onClick={() => {
                    setFinYearId("");
                    setFyGranularity("year");
                    setFyMonth("");
                    setFyDay("");
                    setTimeout(loadData, 0);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="p-4 space-y-4">
              <StyledSelect
                value={finYearId}
                onChange={(v) => {
                  setFinYearId(v);
                  setFyGranularity("year");
                  setFyMonth("");
                  setFyDay("");
                }}
                placeholder="Financial Year"
                options={finYears.map((f) => ({
                  value: String(f.FId),
                  label: f.FName,
                }))}
              />

              {finYearId && (
                <>
                  <div>
                    <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      View By
                    </p>
                    <div className="flex flex-col gap-1">
                      {[
                        {
                          g: "year" as FinYearGranularity,
                          icon: <TrendingUp size={12} />,
                          label: "Full Year",
                        },
                        {
                          g: "month" as FinYearGranularity,
                          icon: <Calendar size={12} />,
                          label: "Specific Month",
                        },
                        {
                          g: "day" as FinYearGranularity,
                          icon: <CalendarRange size={12} />,
                          label: "Specific Day",
                        },
                      ].map(({ g, icon, label }) => (
                        <button
                          key={g}
                          onClick={() => {
                            setFyGranularity(g);
                            setFyMonth("");
                            setFyDay("");
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left
                            ${
                              fyGranularity === g
                                ? "bg-primary/15 text-primary border border-primary/25"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                            }`}
                        >
                          {icon} {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {fyGranularity === "month" && (
                    <div>
                      <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Month
                      </p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          "Apr",
                          "May",
                          "Jun",
                          "Jul",
                          "Aug",
                          "Sep",
                          "Oct",
                          "Nov",
                          "Dec",
                          "Jan",
                          "Feb",
                          "Mar",
                        ].map((m, i) => {
                          const mo = String(i < 9 ? i + 4 : i - 8).padStart(
                            2,
                            "0",
                          );
                          return (
                            <button
                              key={m}
                              onClick={() => setFyMonth(mo)}
                              className={`py-1.5 rounded text-[11px] font-medium transition-all
                                ${fyMonth === mo ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {fyGranularity === "day" && selectedFY && (
                    <div>
                      <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Day
                      </p>
                      <input
                        type="date"
                        value={fyDay}
                        min={selectedFY.FStartDate?.slice(0, 10)}
                        max={selectedFY.FEndDate?.slice(0, 10)}
                        onChange={(e) => setFyDay(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                  )}

                  {selectedFY && (
                    <div className="rounded-lg bg-muted/30 border border-border/60 p-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider">
                        Period
                      </p>
                      <p className="text-xs text-foreground font-medium">
                        {selectedFY.FStartDate?.slice(0, 10)} →{" "}
                        {selectedFY.FEndDate?.slice(0, 10)}
                      </p>
                      {selectedFY.FStatus && (
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${selectedFY.FStatus === "Active" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                        >
                          {selectedFY.FStatus}
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    onClick={loadData}
                    disabled={
                      loading ||
                      (fyGranularity === "month" && !fyMonth) ||
                      (fyGranularity === "day" && !fyDay)
                    }
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                  >
                    <Filter size={13} /> Apply Filter
                  </button>
                </>
              )}

              {!finYearId && (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Select a financial year to filter by year, month, or day.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default Reports;
