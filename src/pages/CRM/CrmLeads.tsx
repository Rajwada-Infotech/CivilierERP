import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, UserPlus, ExternalLink, Users } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const LEADS_API = "/api/sa/leads";
const CUSTOMER_API = "/api/crm/customers";

// Converted leads from Sales Automation land here first, as a pool — they
// are NOT CrmApplications yet. Converting a lead (SaLead.Status ->
// 'Converted', see saHandoff.js) never auto-creates one anymore. Staff pick
// a lead from this pool via "Create Customer" (deep-links into
// CrmCustomers.tsx's New Customer dialog with ?leadId=X pre-selected) —
// that's the real Leads -> Customer step (also the actual "only a converted
// lead may enter the CRM module" gate, enforced again server-side in
// crmCustomers.js POST /). An Application only ever gets created afterwards,
// from that Customer, on the Applications page.
async function fetchConvertedLeads(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(`${LEADS_API}?status=Converted`);
    return res.ok ? res.json() : [];
  } catch { return []; }
}
async function fetchCustomers(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(CUSTOMER_API);
    return res.ok ? res.json() : [];
  } catch { return []; }
}

const CrmLeads: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"Available" | "Used">("Available");

  const { data: leads = [], isLoading } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchConvertedLeads, staleTime: 30_000 });
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-for-leads-pool"], queryFn: fetchCustomers, staleTime: 30_000 });

  // A lead is "used" the moment it's linked to a Customer (CrmCustomer.LeadId)
  // — an Application beyond that is just the next, later step and doesn't
  // change this. Merging in the linked customer here (rather than trusting
  // CrmApplicationId alone) is what keeps this pool in sync with the actual
  // gate now enforced in crmCustomers.js POST /.
  const merged = useMemo(() => {
    const customerByLeadId = new Map((customers as any[]).filter((c: any) => c.LeadId).map((c: any) => [c.LeadId, c]));
    return (leads as any[]).map((l: any) => ({ ...l, _customer: customerByLeadId.get(l.Id) || null }));
  }, [leads, customers]);

  const available = useMemo(() => merged.filter((l) => !l._customer), [merged]);
  const used = useMemo(() => merged.filter((l) => l._customer), [merged]);

  const filtered = useMemo(() => {
    const base = tab === "Available" ? available : used;
    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter((l: any) =>
      l.CustomerName?.toLowerCase().includes(s) || l.Mobile?.includes(search) || l.LeadUid?.toLowerCase().includes(s)
    );
  }, [tab, available, used, search]);

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead", size: 130,
      cell: (i) => (
        <div>
          <div className="font-mono text-xs">{i.row.original.LeadUid}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.DateGenerated ? String(i.row.original.DateGenerated).slice(0, 10) : "—"}</div>
        </div>
      ) },
    { accessorKey: "CustomerName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.CustomerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}{i.row.original.Email ? ` · ${i.row.original.Email}` : ""}</div>
        </div>
      ) },
    { accessorKey: "SourceType", header: "Source", size: 100, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "PropertyType", header: "Interested In", size: 120,
      cell: (i) => <span className="text-xs">{[i.row.original.BhkPreference, i.row.original.PropertyType].filter(Boolean).join(" · ") || "—"}</span> },
    { accessorKey: "PreferredLocation", header: "Preferred Location", size: 130, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "SalespersonName", header: "Salesperson", size: 120, cell: (i) => <span className="text-xs text-muted-foreground">{(i.getValue() as string) || "—"}</span> },
    { id: "action", header: "", size: 150, enableSorting: false,
      cell: (i) => {
        const l = i.row.original;
        return l._customer ? (
          <button
            onClick={() => navigate(`/crm/customers?customerId=${l._customer.Id}`)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            View Customer <ExternalLink size={11} />
          </button>
        ) : (
          <button
            onClick={() => navigate(`/crm/customers?leadId=${l.Id}`)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <UserPlus size={12} /> Create Customer
          </button>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Leads"
      subtitle="Converted leads from Sales Automation, waiting to be linked to a CRM Customer"
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-1">
          {(["Available", "Used"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}>
              <Users size={13} /> {t} ({t === "Available" ? available.length : used.length})
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, lead code..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage={tab === "Available" ? "No converted leads waiting — convert one in Sales Automation first" : "No leads have been linked to a customer yet"}
        className="rounded-xl border border-border overflow-hidden bg-card"
      />
    </SalesAutoShell>
  );
};

export default CrmLeads;
