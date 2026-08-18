import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Users, GitBranch, Clock } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

async function fetchTeamLeadDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/team-lead");
  if (!res.ok) throw new Error("Failed to fetch team lead dashboard");
  return res.json().catch(() => ({}));
}

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number }> = ({ icon: Icon, label, value }) => (
  <div className="rounded-lg border border-border p-4 flex items-start gap-3">
    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
      <Icon size={18} />
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground mt-0.5">{value}</p>
    </div>
  </div>
);

const SaTeamLeadDashboard: React.FC = () => {
  usePageRights("sa-lead-distribution");
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-team-lead"], queryFn: fetchTeamLeadDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  const performanceColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "userName", header: "Salesperson", size: 160,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "leadsAssigned", header: "Leads", size: 90,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.leadsAssigned}</span> },
    { accessorKey: "callsMade", header: "Calls", size: 90,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.callsMade}</span> },
    { accessorKey: "siteVisits", header: "Site Visits", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.siteVisits}</span> },
    { accessorKey: "bookings", header: "Bookings", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.bookings}</span> },
    { accessorKey: "conversionRate", header: "Conversion", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.conversionRate}%</span> },
  ];

  return (
    <SalesAutoShell title="Team Leader Dashboard" subtitle="Lead distribution and salesperson performance overview" icon={GitBranch}>
      <Breadcrumbs items={["Sales Automation", "Team Leader Dashboard"]} />
      <div className="space-y-6">

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard icon={Users} label="Leads Received" value={data?.leadsReceived ?? 0} />
          <StatCard icon={GitBranch} label="Leads Distributed" value={data?.leadsAssigned ?? 0} />
          <StatCard icon={Clock} label="Pending Distribution" value={data?.pendingDistribution ?? 0} />
        </div>

        <MonthlyLeadTrend />

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Salesperson Performance</h3>
          </div>
          <DataTable
            data={data?.salespersonPerformance || []}
            columns={performanceColumns}
            getRowId={(row: any) => String(row.userId)}
            emptyMessage="No salesperson data yet"
            className="bg-card"
          />
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaTeamLeadDashboard;