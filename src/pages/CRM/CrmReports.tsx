import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Calendar, Search, Filter, IndianRupee } from "lucide-react";

const API = "/api/crm/reports";

async function fetchReport(reportType: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const r = await fetchWithAuth(`${API}/${reportType}?${params}`);
  return r.ok ? r.json() : [];
}

const fmt = (n: any) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const dt = (v: any) => v ? String(v).slice(0, 10) : "—";

const CrmReports: React.FC = () => {
  const [activeTab, setActiveTab] = useState("aging-analysis");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-reports", activeTab, fromDate, toDate],
    queryFn: () => fetchReport(activeTab, fromDate, toDate),
    staleTime: 60_000,
  });

  const TABS = [
    { id: "aging-analysis", label: "Aging Analysis" },
    { id: "inventory-status", label: "Inventory Status" },
    { id: "payment-collection", label: "Payment Collection" },
    { id: "booking-register", label: "Booking Register" },
  ];

  return (
    <SalesAutoShell title="CRM Reports" subtitle="Advanced analytics and financial aging lookups">
      
      {/* Filters & Tabs */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex bg-muted/30 p-1 rounded-lg border border-border overflow-x-auto w-full md:w-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${activeTab === t.id ? "bg-background shadow-sm border border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
            <Calendar size={14} className="text-muted-foreground" />
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="text-sm bg-transparent outline-none" />
            <span className="text-muted-foreground text-xs">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="text-sm bg-transparent outline-none" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
            <Filter size={14} /> Filter
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading report data...</div>
        ) : !data || data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No data found for the selected period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  {Object.keys(data[0]).map((k) => (
                    <th key={k} className="px-4 py-3 font-semibold">{k.replace(/([A-Z])/g, ' $1').trim()}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    {Object.entries(row).map(([k, v]: [string, any], j) => (
                      <td key={j} className="px-4 py-3">
                        {k.toLowerCase().includes('amount') || k.toLowerCase().includes('balance') || k.toLowerCase().includes('value') ? (
                          <span className="font-semibold">{fmt(v)}</span>
                        ) : k.toLowerCase().includes('date') ? (
                          dt(v)
                        ) : (
                          v?.toString() || "—"
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SalesAutoShell>
  );
};

export default CrmReports;
