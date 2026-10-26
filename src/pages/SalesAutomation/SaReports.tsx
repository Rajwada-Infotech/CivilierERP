import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToXlsx, exportToPdf, type ExportColumn } from "@/lib/export";
import { Download, FileSpreadsheet } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

// Was one flat, unthemed row of 12 identically-styled buttons — finding the
// right one meant reading every label. Grouped by what the report is about;
// each report keeps its own key/cols unchanged.
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
  return res.json().catch(() => ({}));
}

function deriveColumns(rows: any[]): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

function formatHeader(key: string): string {
  return key.replace(/([A-Z])/g, " $1").trim();
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

const SaReports: React.FC = () => {
  usePageRights("sa-reports");
  const [selected, setSelected] = useState(REPORTS[0].key);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["sa-report", selected, dateFrom, dateTo],
    queryFn: () => fetchReport(selected, dateFrom || undefined, dateTo || undefined),
    staleTime: 60_000,
  });

  const reportMeta = REPORTS.find((r) => r.key === selected);
  const columns = useMemo(() => rows.length ? deriveColumns(rows) : (reportMeta?.cols ?? []), [rows, reportMeta]);
  const reportLabel = REPORTS.find((r) => r.key === selected)?.label || "Report";

  const handleExportExcel = () => {
    const exportCols: ExportColumn[] = columns.map((c) => ({ header: formatHeader(c), accessor: c }));
    exportToXlsx(rows, exportCols, selected, reportLabel);
  };
  const handleExportPdf = () => {
    const exportCols: ExportColumn[] = columns.map((c) => ({ header: formatHeader(c), accessor: c }));
    exportToPdf(rows, exportCols, { title: reportLabel, filename: selected });
  };

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Reports"]} title="Sales Automation Reports" subtitle="Lead source, performance, conversion and ROI reports">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center flex-wrap gap-2">
            {/* Date range filter */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground">From</label>
              <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground">To</label>
              <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline">
                Clear
              </button>
            )}
            <button onClick={handleExportExcel} disabled={!rows.length} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={handleExportPdf} disabled={!rows.length} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
              <Download size={14} /> PDF
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {REPORT_GROUPS.map((g) => (
            <div key={g.group}>
              <h3 className="text-[0.6875rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{g.group}</h3>
              <div className="flex flex-wrap gap-2">
                {g.reports.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setSelected(r.key)}
                    title={r.desc}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${selected === r.key ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="p-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{formatHeader(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={Math.max(columns.length, 1)} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={Math.max(columns.length, 1)} className="p-6 text-center text-red-500">Failed to load report.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={Math.max(columns.length, 1)} className="p-6 text-center text-muted-foreground">No data for this report yet</td></tr>
              ) : rows.map((row: any, idx: number) => (
                <tr key={idx} className="border-t border-border hover:bg-muted/20 transition-colors">
                  {columns.map((c) => (
                    <td key={c} className="p-3 text-foreground whitespace-nowrap">{formatCell(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaReports;