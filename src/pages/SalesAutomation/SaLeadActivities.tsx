import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { MessageCircle, Phone, Search } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { LeadInteractionForm } from "@/components/sa/LeadInteractionForm";

const API = "/api/sa/lead-activities";

async function fetchActivities(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch activities");
  return res.json().catch(() => []);
}

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

const SaLeadActivities: React.FC = () => {
  usePageRights("sa-lead-activities");
  const { canDoAction } = useAuth();
  const [query, setQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const { data: activities = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-lead-activities"], queryFn: fetchActivities, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) => [a.LeadUid, a.CustomerName, a.Mobile, a.ActivityType, a.Outcome, a.Summary]
      .some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [activities, query]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading activities...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load activities.</div>;

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead", size: 100, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.row.original.LeadUid}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 140,
      cell: (i) => (<><div className="font-medium">{i.row.original.CustomerName}</div><div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div></>) },
    { accessorKey: "ActivityType", header: "Activity", size: 110,
      cell: (i) => <span className="inline-flex items-center gap-1.5">{i.row.original.ActivityType === "Call" ? <Phone size={13} /> : <MessageCircle size={13} />}{i.row.original.ActivityType}</span> },
    { accessorKey: "Outcome", header: "Outcome", size: 100, cell: (i) => <span className="text-xs">{i.row.original.Outcome || "-"}</span> },
    { accessorKey: "Summary", header: "Summary", size: 220, cell: (i) => <span>{i.row.original.Summary}</span> },
    { accessorKey: "NextFollowupDate", header: "Next Follow-up", size: 130,
      cell: (i) => <span className="whitespace-nowrap">{i.row.original.NextFollowupDate ? String(i.row.original.NextFollowupDate).slice(0, 10) : "-"}</span> },
    { accessorKey: "CreatedByName", header: "Logged By", size: 110, cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CreatedByName || "System"}</span> },
    { accessorKey: "CreatedAt", header: "Created", size: 140,
      cell: (i) => <span className="text-xs text-muted-foreground whitespace-nowrap">{i.row.original.CreatedAt ? new Date(i.row.original.CreatedAt).toLocaleString() : "-"}</span> },
  ];

  return (
    <SalesAutoShell title="Lead Activities" subtitle="Log calls, WhatsApp, meetings and next follow-up dates against leads"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Lead Activities"]} />
      <div className="space-y-5">
        {canDoAction("sa-lead-activities", "create") && (
          <div className="space-y-3 rounded-lg border border-border p-4 bg-background">
            <SearchableNativeSelect value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)} className="max-w-sm border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Select lead</option>
              {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
            </SearchableNativeSelect>
            <LeadInteractionForm leadId={selectedLeadId ? parseInt(selectedLeadId) : null} />
          </div>
        )}

        <div className="flex items-center gap-2 max-w-md">
          <Search size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity timeline" className="w-full border border-border rounded-md bg-background px-3 py-2 text-sm" />
        </div>

        <DataTable
          data={filtered}
          columns={columns}
          searchable={false}
          emptyMessage="No activities yet"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadActivities;
