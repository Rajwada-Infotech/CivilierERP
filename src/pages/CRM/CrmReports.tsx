import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Calendar, Download, ChevronDown, ChevronRight } from "lucide-react";

const API = "/api/crm/reports";

// ---------- helpers ----------
const fmt = (n: any) => (n != null ? `?${Number(n).toLocaleString("en-IN")}` : "�");
const dt = (v: any) => (v ? String(v).slice(0, 10) : "�");

const MONEY_KEYS = /amount|balance|value|due|paid|fee|duty|brokerage|refund|deduction/i;
const DATE_KEYS  = /date|deadline/i;
const PCT_KEYS   = /percent|complete/i;

function fmtCell(key: string, val: any): string {
  if (val == null || val === "") return "�";
  if (MONEY_KEYS.test(key)) return fmt(val);
  if (PCT_KEYS.test(key)) return `${val}%`;
  if (DATE_KEYS.test(key)) return dt(val);
  return String(val);
}

function humanHeader(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

// ---------- CSV export ----------
function exportCSV(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h] == null ? "" : String(r[h]);
          return v.includes(",") || v.includes('"') || v.includes("\n")
            ? `"${v.replace(/"/g, '""')}"`
            : v;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- report catalogue ----------
type ReportDef = { id: string; label: string; desc: string; dateable?: boolean };
type Category  = { label: string; emoji: string; reports: ReportDef[] };

const CATEGORIES: Category[] = [
  {
    label: "Operations",
    emoji: "??",
    reports: [
      { id: "booking-register",     label: "Booking Register",       desc: "All active bookings with customer, unit, and booking value.", dateable: true },
      { id: "application-funnel",   label: "Application Funnel",     desc: "Lead-to-booking conversion count by application status.", dateable: true },
      { id: "booking-status-summary", label: "Booking Status Summary", desc: "Total count and value of bookings grouped by status." },
      { id: "welcome-call-report",  label: "Welcome Call",           desc: "Post-booking onboarding calls and next-call schedule.", dateable: true },
      { id: "agreement-report",     label: "Agreement",              desc: "Sale agreement drafting, senior and customer approval status." },
      { id: "legal-milestones",     label: "Legal Milestones",       desc: "Title clearance and legal documentation step completion." },
    ],
  },
  {
    label: "Financial",
    emoji: "??",
    reports: [
      { id: "payment-collection",   label: "Payment Collection",     desc: "Milestone-wise due, paid, and balance per active booking.", dateable: true },
      { id: "aging-analysis",       label: "Aging Analysis",         desc: "Overdue payments bucketed by 0�30, 31�60, 61�90, 90+ days." },
      { id: "receipt-register",     label: "Receipt Register",       desc: "All money received � receipt number, mode, and transaction ref.", dateable: true },
      { id: "overdue-payments",     label: "Overdue Payments",       desc: "Pending milestones past their due date on active bookings." },
      { id: "brokerage-report",     label: "Brokerage",              desc: "Broker-wise computed vs paid brokerage with balance.", dateable: true },
    ],
  },
  {
    label: "Legal & Closure",
    emoji: "??",
    reports: [
      { id: "sales-deed-report",        label: "Sales Deed",           desc: "Registration status, stamp duty, and approval states per deed." },
      { id: "noc-report",               label: "NOC",                  desc: "Bank and society NOC requests with loan amount and status.", dateable: true },
      { id: "possession-notice-report", label: "Possession Notice",    desc: "Formal possession offers with delivery mode and deadline." },
      { id: "pre-possession-report",    label: "Pre-Possession",       desc: "Inspection checklist completion before possession." },
    ],
  },
  {
    label: "Inventory & Handover",
    emoji: "??",
    reports: [
      { id: "inventory-status",     label: "Inventory Status",       desc: "Unit availability matrix: total, booked, and available per project." },
      { id: "parking-report",       label: "Parking Allotment",      desc: "Parking slot allotments with payment status." },
      { id: "handover-report",      label: "Handover",               desc: "Key handover progress � scheduled, actual, and clearance flags." },
      { id: "construction-updates", label: "Construction Updates",   desc: "Project stage and completion percentage log.", dateable: true },
    ],
  },
  {
    label: "Customer & After-Sales",
    emoji: "??",
    reports: [
      { id: "customer-report",      label: "Customer Master",        desc: "All customers with contact info and total bookings.", dateable: true },
      { id: "cancellation-report",  label: "Cancellations",         desc: "Cancellation requests with deduction, refund, and status.", dateable: true },
      { id: "service-tickets",      label: "Service Tickets",       desc: "After-sales support tickets with priority and SLA deadline.", dateable: true },
    ],
  },
];

const ALL_REPORTS: ReportDef[] = CATEGORIES.flatMap((c) => c.reports);

// ---------- table component ----------
const ReportTable: React.FC<{ rows: any[] }> = ({ rows }) => {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="bg-muted/50 border-b border-border sticky top-0 z-10">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {humanHeader(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/20 transition-colors">
              {headers.map((h, j) => (
                <td key={j} className={`px-4 py-3 whitespace-nowrap ${MONEY_KEYS.test(h) ? "font-semibold tabular-nums" : ""}`}>
                  {fmtCell(h, row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------- main page ----------
const CrmReports: React.FC = () => {
  const [activeId, setActiveId] = useState("booking-register");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({
    Operations: true,
    Financial: true,
    "Legal & Closure": false,
    "Inventory & Handover": false,
    "Customer & After-Sales": false,
  });

  const active = ALL_REPORTS.find((r) => r.id === activeId)!;

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["crm-reports", activeId, fromDate, toDate],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (fromDate) p.set("from", fromDate);
      if (toDate) p.set("to", toDate);
      const r = await fetchWithAuth(`${API}/${activeId}?${p}`);
      return r.ok ? r.json() : [];
    },
    staleTime: 60_000,
  });

  const toggleCat = (label: string) =>
    setOpenCats((prev) => ({ ...prev, [label]: !prev[label] }));

  const dateChip =
    fromDate || toDate
      ? `${fromDate || "start"} ? ${toDate || "today"}`
      : null;

  return (
    <CrmShell title="CRM Reports" subtitle="Analytics and exports for all CRM modules">
      <div className="flex gap-5 min-h-[600px]">
        {/* -- sidebar nav -- */}
        <aside className="w-52 shrink-0 space-y-1">
          {CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <button
                onClick={() => toggleCat(cat.label)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                {openCats[cat.label] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{cat.emoji} {cat.label}</span>
              </button>
              {openCats[cat.label] && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {cat.reports.map((rep) => (
                    <button
                      key={rep.id}
                      onClick={() => setActiveId(rep.id)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                        activeId === rep.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {rep.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* -- report panel -- */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* header row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{active.label}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{active.desc}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* date range */}
              {active.dateable !== false && (
                <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-1.5 text-sm">
                  <Calendar size={13} className="text-muted-foreground" />
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-transparent outline-none text-xs w-28"
                    title="From date"
                  />
                  <span className="text-muted-foreground text-xs">�</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-transparent outline-none text-xs w-28"
                    title="To date"
                  />
                  {(fromDate || toDate) && (
                    <button
                      onClick={() => { setFromDate(""); setToDate(""); }}
                      className="text-muted-foreground hover:text-foreground text-xs ml-1"
                      title="Clear dates"
                    >
                      ?
                    </button>
                  )}
                </div>
              )}

              {/* export */}
              <button
                onClick={() =>
                  exportCSV(data, `CRM_${active.label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`)
                }
                disabled={!data.length}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-40"
              >
                <Download size={13} /> Export CSV
              </button>
            </div>
          </div>

          {/* applied filter chip */}
          {dateChip && (
            <div className="text-xs text-muted-foreground">
              Filtered: <span className="font-medium text-foreground">{dateChip}</span>
            </div>
          )}

          {/* table card */}
          <div className="rounded-xl border border-border bg-card flex-1 overflow-hidden flex flex-col">
            {/* record count bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
              <span className="text-xs text-muted-foreground">
                {isLoading ? "Loading�" : `${data.length} record${data.length !== 1 ? "s" : ""}`}
              </span>
            </div>

            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8">
                Loading {active.label}�
              </div>
            ) : data.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground p-8 gap-2">
                <span className="text-2xl">??</span>
                <span>No records found{dateChip ? " for the selected date range" : ""}.</span>
                {dateChip && (
                  <button
                    onClick={() => { setFromDate(""); setToDate(""); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Clear date filter
                  </button>
                )}
              </div>
            ) : (
              <ReportTable rows={data} />
            )}
          </div>
        </div>
      </div>
    </CrmShell>
  );
};

export default CrmReports;
