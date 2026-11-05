import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToXlsx, exportToPdf, type ExportColumn } from "@/lib/export";
import { Download, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { formatINR } from "@/utils/formatCurrency";
import { fmtPct } from "@/components/sa/saCells";

// Grouped by what the report is about; each report keeps its own key/cols.
const REPORT_GROUPS = [
  {
    group: "Marketing & Campaigns",
    reports: [
      { key: "lead-source", label: "Lead Source", desc: "Leads, bookings, and losses by source platform", cols: ["Platform", "TotalLeads", "Bookings", "Lost"] },
      { key: "campaign-performance", label: "Campaign Performance", desc: "Spend, leads, and conversion per campaign", cols: ["CampaignCode", "Name", "Budget", "Status", "TotalAds", "TotalLeads", "CostSpent", "Bookings", "ConversionPct"] },
      { key: "ad-performance", label: "Advertisement Performance", desc: "Spend, leads, and ROI per ad", cols: ["Name", "CampaignName", "Status", "Budget", "Spent", "LeadsGenerated", "Bookings", "CostPerLead", "ConversionRate", "RoiPercent"] },
      { key: "daily-ad-performance", label: "Daily Reach & Cost", desc: "Day-by-day reach and cost per ad", cols: ["ReportDate", "AdName", "CampaignName", "DailyReach", "DailyCost", "CostPerLead"] },
      { key: "cost-per-lead", label: "Cost Per Lead", desc: "Spend-to-lead efficiency per campaign", cols: ["CampaignName", "CampaignCode", "TotalSpent", "TotalLeads", "CostPerLead"] },
      { key: "marketing-roi", label: "Marketing ROI", desc: "Spend vs. revenue per campaign", cols: ["CampaignName", "CampaignCode", "TotalSpent", "TotalRevenue", "ROI"] },
    ],
  },
  {
    group: "Sales & Team Performance",
    reports: [
      { key: "sales-performance", label: "Sales Performance", desc: "Leads, calls, visits, and bookings per salesperson", cols: ["SalespersonName", "LeadsHandled", "CallsMade", "SiteVisits", "Bookings"] },
      { key: "team-leader-performance", label: "Team Leader Performance", desc: "Distribution and bookings per team lead", cols: ["TeamLeadName", "LeadsReceived", "LeadsDistributed", "PendingDistribution", "TeamBookings"] },
      { key: "executive-performance", label: "Executive Performance", desc: "Site visits assigned vs. completed per executive", cols: ["ExecutiveName", "VisitsAssigned", "VisitsCompleted", "VisitsCancelled"] },
      { key: "booking-conversion", label: "Booking Conversion", desc: "Lead-to-booking conversion per campaign", cols: ["CampaignName", "CampaignCode", "TotalLeads", "Visited", "Booked", "ConversionRate"] },
    ],
  },
  {
    group: "Operations",
    reports: [
      { key: "inquiry-status", label: "Inquiry Status", desc: "Count of inquiries by current status", cols: ["Status", "Cnt"] },
      { key: "site-visit", label: "Site Visit", desc: "Scheduled and completed site visits", cols: ["CustomerName", "Mobile", "ProjectName", "ExecutiveName", "PreferredDate", "Status"] },
    ],
  },
];
const REPORTS = REPORT_GROUPS.flatMap((g) => g.reports);

async function fetchReport(key: string, from?: string, to?: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await fetchWithAuth(`/api/sa/reports/${key}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch report");
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

// ── Column kinds, read from the column name the API returns ──────────────
type Kind = "money" | "pct" | "date" | "count" | "text";
const kindOf = (col: string): Kind => {
  if (/(Pct|Percent|Rate$|^ROI$)/i.test(col)) return "pct";
  if (/(Budget|Spent|Spend|Cost|Revenue|Value|Amount)/i.test(col)) return "money";
  if (/(Date|At$)/.test(col)) return "date";
  if (/(Count|Cnt|Total|Leads|Bookings|Booked|Visits|Visited|Calls|Lost|Ads|Reach|Received|Distributed|Pending|Handled)/i.test(col)) return "count";
  return "text";
};
const HEADER_WORDS: Record<string, string> = { Cnt: "Count", Roi: "ROI", Pct: "%", Percent: "%" };
const formatHeader = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ").map((w) => HEADER_WORDS[w] ?? w).join(" ");

function formatCell(value: any, kind: Kind): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return formatINR(value);
  if (kind === "pct") return fmtPct(Number(value) || 0);
  if (kind === "date") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toFixed(2);
  return String(value);
}

// ── Date presets ──────────────────────────────────────────────────────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Last 7 days", range: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 6); return [ymd(f), ymd(t)]; } },
  { label: "This month", range: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)]; } },
  { label: "Last month", range: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))]; } },
  // Indian financial year: 1 April – 31 March.
  { label: "This FY", range: () => { const t = new Date(); const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; return [ymd(new Date(y, 3, 1)), ymd(t)]; } },
];

const SaReports: React.FC = () => {
  usePageRights("sa-reports");
  const [selected, setSelected] = useState(REPORTS[0].key);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const { data: rows = [], isLoading, isFetching, error } = useQuery({
    queryKey: ["sa-report", selected, dateFrom, dateTo],
    queryFn: () => fetchReport(selected, dateFrom || undefined, dateTo || undefined),
    staleTime: 60_000,
  });

  const report = REPORTS.find((r) => r.key === selected) ?? REPORTS[0];
  const columns = useMemo(() => (rows.length ? Object.keys(rows[0]) : report.cols), [rows, report]);
  const kinds = useMemo(() => Object.fromEntries(columns.map((c) => [c, kindOf(c)])) as Record<string, Kind>, [columns]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q ? rows.filter((r) => columns.some((c) => String(r[c] ?? "").toLowerCase().includes(q))) : rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        const nx = Number(x), ny = Number(y);
        const cmp = x != null && y != null && !isNaN(nx) && !isNaN(ny) && kinds[sort.col] !== "text"
          ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""));
        return cmp * sort.dir;
      });
    }
    return out;
  }, [rows, columns, kinds, search, sort]);

  // Totals only make sense for amounts and counts — never for % or dates.
  const totals = useMemo(() => {
    if (shown.length < 2) return null;
    const t: Record<string, number> = {};
    columns.forEach((c) => {
      if (kinds[c] === "money" || kinds[c] === "count") t[c] = shown.reduce((s, r) => s + (Number(r[c]) || 0), 0);
    });
    return Object.keys(t).length ? t : null;
  }, [shown, columns, kinds]);

  const pick = (key: string) => { setSelected(key); setSearch(""); setSort(null); };
  const toggleSort = (col: string) =>
    setSort((s) => (s?.col !== col ? { col, dir: -1 } : s.dir === -1 ? { col, dir: 1 } : null));

  const exportCols: ExportColumn[] = columns.map((c) => ({ header: formatHeader(c), accessor: c }));
  const activePreset = PRESETS.find((p) => { const [f, t] = p.range(); return f === dateFrom && t === dateTo; })?.label;
  const rangeText = dateFrom || dateTo ? `${dateFrom || "start"} to ${dateTo || "today"}` : "All dates";

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Reports"]} title="Reports" subtitle="Lead source, team performance, conversion and marketing return">
      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Report picker */}
        <nav aria-label="Reports" className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {REPORT_GROUPS.map((g) => (
            <div key={g.group}>
              <h3 className="px-2 mb-1 text-[0.6875rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground">{g.group}</h3>
              <ul className="space-y-0.5">
                {g.reports.map((r) => {
                  const active = r.key === selected;
                  return (
                    <li key={r.key}>
                      <button
                        onClick={() => pick(r.key)}
                        aria-current={active ? "page" : undefined}
                        className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors border ${active ? "bg-primary/10 border-primary/30" : "border-transparent hover:bg-muted/60"}`}
                      >
                        <div className={`text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>{r.label}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{r.desc}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Selected report */}
        <section className="min-w-0 rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3.5 border-b border-border space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">{report.label}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {report.desc} · {rangeText}{!isLoading && ` · ${shown.length} row${shown.length === 1 ? "" : "s"}`}{isFetching && !isLoading ? " · updating…" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => exportToXlsx(shown, exportCols, selected, report.label)} disabled={!shown.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
                  <FileSpreadsheet size={14} /> Excel
                </button>
                <button onClick={() => exportToPdf(shown, exportCols, { title: report.label, filename: selected })} disabled={!shown.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
                  <Download size={14} /> PDF
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => { const [f, t] = p.range(); setDateFrom(f); setDateTo(t); }}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${activePreset === p.label ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                    {p.label}
                  </button>
                ))}
                <button onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${!dateFrom && !dateTo ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  All dates
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date"
                  className="text-xs border border-border rounded px-2 py-1 bg-background" />
                <span className="text-xs text-muted-foreground">to</span>
                <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date"
                  className="text-xs border border-border rounded px-2 py-1 bg-background" />
              </div>
              <label className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1 bg-background">
                <Search size={13} className="text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rows…"
                  className="w-36 bg-transparent text-xs outline-none" />
              </label>
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {columns.map((c) => {
                    const num = kinds[c] !== "text" && kinds[c] !== "date";
                    const Icon = sort?.col !== c ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
                    return (
                      <th key={c} className={`p-0 text-xs font-medium text-muted-foreground whitespace-nowrap ${num ? "text-right" : "text-left"}`}>
                        <button onClick={() => toggleSort(c)} className={`w-full inline-flex items-center gap-1 px-3 py-2.5 hover:text-foreground ${num ? "justify-end" : ""}`}>
                          {formatHeader(c)} <Icon size={11} className={sort?.col === c ? "text-foreground" : "opacity-40"} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={Math.max(columns.length, 1)} className="p-8 text-center text-muted-foreground">Loading report…</td></tr>
                ) : error ? (
                  <tr><td colSpan={Math.max(columns.length, 1)} className="p-8 text-center text-red-500">Couldn't load this report. Try again, or pick a different date range.</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={Math.max(columns.length, 1)} className="p-8 text-center text-muted-foreground">
                    {search ? "No rows match your filter." : dateFrom || dateTo ? "Nothing in this date range. Try All dates." : "No data for this report yet."}
                  </td></tr>
                ) : shown.map((row: any, idx: number) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/20 transition-colors">
                    {columns.map((c) => {
                      const k = kinds[c];
                      const neg = (k === "pct" || k === "money") && Number(row[c]) < 0;
                      return (
                        <td key={c} className={`px-3 py-2.5 whitespace-nowrap ${k === "text" || k === "date" ? "text-foreground" : "text-right tabular-nums"} ${neg ? "text-red-500" : ""}`}>
                          {formatCell(row[c], k)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {totals && !isLoading && !error && (
                <tfoot className="border-t-2 border-border bg-muted/30 text-xs font-semibold">
                  <tr>
                    {columns.map((c, i) => (
                      <td key={c} className={`px-3 py-2.5 whitespace-nowrap ${c in totals ? "text-right tabular-nums" : ""}`}>
                        {c in totals ? formatCell(totals[c], kinds[c]) : i === 0 ? "Total" : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </SalesAutoShell>
  );
};

export default SaReports;
