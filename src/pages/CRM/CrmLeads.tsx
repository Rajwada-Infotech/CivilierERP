import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, UserPlus, ExternalLink, Users, CheckCircle2 } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useTheme } from "@/contexts/ThemeContext";

const LEADS_API = "/api/sa/leads";
const CUSTOMER_API = "/api/crm/customers";

// Converted leads from Sales Automation land here first, as a pool � they
// are NOT CrmApplications yet. Converting a lead (SaLead.Status ->
// 'Converted', see saHandoff.js) never auto-creates one anymore. Staff pick
// a lead from this pool via "Create Customer" (deep-links into
// CrmCustomers.tsx's New Customer dialog with ?leadId=X pre-selected) �
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
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"Available" | "Used">("Available");

  const { data: leads = [], isLoading } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchConvertedLeads, staleTime: 30_000 });
  const { data: customers = [] } = useQuery({ queryKey: ["crm-customers-for-leads-pool"], queryFn: fetchCustomers, staleTime: 30_000 });

  // A lead is "used" the moment it's linked to a Customer (CrmCustomer.LeadId)
  // � an Application beyond that is just the next, later step and doesn't
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
          <div className="text-xs text-muted-foreground">{i.row.original.DateGenerated ? String(i.row.original.DateGenerated).slice(0, 10) : "�"}</div>
        </div>
      ) },
    { accessorKey: "CustomerName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.CustomerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}{i.row.original.Email ? ` � ${i.row.original.Email}` : ""}</div>
        </div>
      ) },
    { accessorKey: "SourceType", header: "Source", size: 100, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "�"}</span> },
    { accessorKey: "PropertyType", header: "Interested In", size: 120,
      cell: (i) => <span className="text-xs">{[i.row.original.BhkPreference, i.row.original.PropertyType].filter(Boolean).join(" � ") || "�"}</span> },
    { accessorKey: "PreferredLocation", header: "Preferred Location", size: 130, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "�"}</span> },
    { accessorKey: "SalespersonName", header: "Salesperson", size: 120, cell: (i) => <span className="text-xs text-muted-foreground">{(i.getValue() as string) || "�"}</span> },
    { id: "action", header: "", size: 150, enableSorting: false,
      cell: (i) => {
        const l = i.row.original;
        return l._customer ? (
          <button
            onClick={() => navigate(`/crm/customers?customerId=${l._customer.Id}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            View Customer <ExternalLink size={11} />
          </button>
        ) : (
          <button
            onClick={() => navigate(`/crm/customers?leadId=${l.Id}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all"
          >
            <UserPlus size={12} /> Create Customer
          </button>
        );
      } },
  ];

  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(245,158,11,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };
  const borderColor = isDark ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.12)";

  return (
    <CrmShell
      title="CRM � Leads"
      subtitle="Converted leads from Sales Automation, waiting to be linked to a CRM Customer"
    >
      {/* Toolbar + table live in one continuous card instead of a loose
          toolbar row floating above a separately-bordered table. */}
      <div className="rounded-xl overflow-hidden" style={glassStyle}>
        <div className="flex gap-3 flex-wrap items-center px-4 py-3 border-b" style={{ borderColor }}>
          <div className="flex items-center gap-1 rounded-lg bg-muted/20 p-1 shrink-0">
            {(["Available", "Used"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-medium rounded-lg transition-all ${
                  tab === t
                    ? "text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}>
                {t === "Available" ? <Users size={13} /> : <CheckCircle2 size={13} />} {t} ({t === "Available" ? available.length : used.length})
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, mobile, lead code..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
        </div>

        {/* Custom, actionable empty state � DataTable's own emptyMessage is
            plain text only, and "convert one in Sales Automation" used to
            be a dead end with no way to actually get there. */}
        {!isLoading && filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 px-6 text-center">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: "rgba(245,158,11,0.12)" }}
            >
              {tab === "Available" ? (
                <Users size={20} style={{ color: "#f59e0b" }} />
              ) : (
                <CheckCircle2 size={20} style={{ color: "#f59e0b" }} />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-heading font-semibold text-foreground">
                {search
                  ? "No leads match your search"
                  : tab === "Available"
                    ? "No converted leads waiting"
                    : "No leads linked to a customer yet"}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {search
                  ? "Try a different name, mobile number, or lead code."
                  : tab === "Available"
                    ? "Leads land here the moment they're marked Converted in Sales Automation."
                    : "Once a lead is turned into a CRM Customer, it'll show up here for reference."}
              </p>
            </div>
          </div>
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            searchable={false}
            loading={isLoading}
            className="border-0"
          />
        )}
      </div>
    </CrmShell>
  );
};

export default CrmLeads;
