import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { MessageCircle, Phone, Search, Plus, X, Users, Mail } from "lucide-react";
import { TitleCell } from "@/components/sa/saCells";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
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

const TYPE_ICONS: Record<string, React.ElementType> = { Call: Phone, Meeting: Users, Email: Mail, WhatsApp: MessageCircle, SMS: MessageCircle };
const fmtDay = (d: unknown) =>
  new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtWhen = (d: unknown) =>
  d ? new Date(String(d)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

const SaLeadActivities: React.FC = () => {
  usePageRights("sa-lead-activities");
  const { canDoAction } = useAuth();
  const [query, setQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const { data: activities = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-lead-activities"], queryFn: fetchActivities, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });

  const [type, setType] = useState("All");
  const [formOpen, setFormOpen] = useState(false);
  // Types come from the data itself, so a new activity type shows up here
  // without a code change.
  const types = useMemo(() => Array.from(new Set(activities.map((a) => a.ActivityType).filter(Boolean))).sort(), [activities]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activities.filter((a) => (type === "All" || a.ActivityType === type)
      && (!q || [a.LeadUid, a.CustomerName, a.Mobile, a.ActivityType, a.Outcome, a.Summary, a.CreatedByName]
        .some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [activities, query, type]);

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Activities"]} title="Lead Activities">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load activities. Refresh the page to try again." : "Loading activities…"}
      </div>
    </SalesAutoShell>
  );

  const todayStr = new Date().toDateString();
  const loggedToday = activities.filter((a) => a.CreatedAt && new Date(a.CreatedAt).toDateString() === todayStr).length;
  const startToday = new Date(todayStr).getTime();

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "CreatedAt", header: "When", size: 120,
      cell: (i) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(i.row.original.CreatedAt)}</span> },
    { accessorKey: "CustomerName", header: "Lead", size: 150,
      cell: (i) => TitleCell(i.row.original.CustomerName, [i.row.original.LeadUid, i.row.original.Mobile].filter(Boolean).join(" · ")) },
    { accessorKey: "ActivityType", header: "Activity", size: 120,
      cell: (i) => {
        const Icon = TYPE_ICONS[i.row.original.ActivityType] ?? MessageCircle;
        return <span className="inline-flex items-center gap-1.5 text-sm"><Icon size={13} className="text-muted-foreground" />{i.row.original.ActivityType}</span>;
      } },
    { accessorKey: "Outcome", header: "Outcome", size: 110,
      cell: (i) => (i.row.original.Outcome ? <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground whitespace-nowrap">{i.row.original.Outcome}</span> : <span className="text-muted-foreground text-xs">—</span>) },
    { accessorKey: "Summary", header: "What was said", size: 240, cell: (i) => <span className="text-sm">{i.row.original.Summary || "—"}</span> },
    { accessorKey: "NextFollowupDate", header: "Next follow-up", size: 120,
      cell: (i) => {
        const d = i.row.original.NextFollowupDate;
        const late = d && new Date(String(d).slice(0, 10)).getTime() < startToday;
        return <span className={`whitespace-nowrap text-sm ${late ? "text-red-600 font-medium" : ""}`}>{d ? fmtDay(d) : "—"}</span>;
      } },
    { accessorKey: "CreatedByName", header: "By", size: 100, cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.CreatedByName || "System"}</span> },
  ];

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Activities"]} title="Lead Activities"
      subtitle={`Every call, message and meeting logged against a lead — ${loggedToday} logged today, ${activities.length} in all`}
      action={<div className="flex items-center gap-2">
        {canDoAction("sa-lead-activities", "create") && (
          <button onClick={() => setFormOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 rounded-md px-3 text-sm font-medium ${formOpen ? "border border-border text-muted-foreground hover:bg-muted" : "btn-module text-white shadow-sm"}`}>
            {formOpen ? <><X size={14} /> Close</> : <><Plus size={14} /> Log activity</>}
          </button>
        )}
        <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
      </div>}>
      <div className="space-y-5">
        {formOpen && canDoAction("sa-lead-activities", "create") && (
          <div className="space-y-3 rounded-xl border border-border p-4 bg-card">
            <label className="block space-y-1 max-w-sm">
              <span className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">Lead<span className="text-destructive ml-0.5">*</span></span>
              <SearchableNativeSelect value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)} className="w-full border border-border rounded-md bg-background px-3 py-2 text-sm">
                <option value="">Select a lead</option>
                {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
              </SearchableNativeSelect>
            </label>
            {selectedLeadId
              ? <LeadInteractionForm leadId={parseInt(selectedLeadId)} />
              : <p className="text-xs text-muted-foreground">Pick the lead first, then log what happened.</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {["All", ...types].map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${type === t ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                {t} <span className="tabular-nums opacity-70">{t === "All" ? activities.length : activities.filter((a) => a.ActivityType === t).length}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 bg-background w-full sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Lead, mobile, outcome or note" className="flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>

        <DataTable
          data={filtered}
          columns={columns}
          searchable={false}
          emptyMessage={query || type !== "All" ? "Nothing matches." : "No activities logged yet."}
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadActivities;
