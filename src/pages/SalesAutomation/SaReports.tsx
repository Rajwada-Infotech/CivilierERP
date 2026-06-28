import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToXlsx, exportToPdf, type ExportColumn } from "@/lib/export";
import { Download, FileSpreadsheet } from "lucide-react";

const REPORTS = [
  { key: "lead-source", label: "Lead Source Report" },
  { key: "campaign-performance", label: "Campaign Performance Report" },
  { key: "ad-performance", label: "Advertisement Performance Report" },
  { key: "cost-per-lead", label: "Cost Per Lead Report" },
  { key: "sales-performance", label: "Sales Performance Report" },
  { key: "team-leader-performance", label: "Team Leader Performance Report" },
  { key: "executive-performance", label: "Executive Performance Report" },
  { key: "inquiry-status", label: "Inquiry Status Report" },
  { key: "site-visit", label: "Site Visit Report" },
  { key: "booking-conversion", label: "Booking Conversion Report" },
  { key: "marketing-roi", label: "Marketing ROI Report" },
];

async function fetchReport(key: string): Promise<any[]> {
  const res = await fetchWithAuth(`/api/sa/reports/${key}`);
  if (!res.ok) throw new Error("Failed to fetch report");
  return res.json();
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
  const [selected, setSelected] = useState(REPORTS[0].key);
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["sa-report", selected],
    queryFn: () => fetchReport(selected),
    staleTime: 60_000,
  });

  const columns = useMemo(() => deriveColumns(rows), [rows]);
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
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Reports"]} />
      <div className="space-y-6 mt-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">Sales Automation Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Lead source, performance, conversion and ROI reports</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleExportExcel} disabled={!rows.length} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={handleExportPdf} disabled={!rows.length} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
              <Download size={14} /> PDF
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setSelected(r.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${selected === r.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {r.label}
            </button>
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
    </>
  );
};

export default SaReports;