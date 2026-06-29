import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Users, GitBranch, Clock } from "lucide-react";

async function fetchTeamLeadDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/team-lead");
  if (!res.ok) throw new Error("Failed to fetch team lead dashboard");
  return res.json();
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
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-team-lead"], queryFn: fetchTeamLeadDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Team Leader Dashboard"]} />
      <div className="space-y-6 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Team Leader Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Lead distribution and salesperson performance overview</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Users} label="Leads Received" value={data?.leadsReceived ?? 0} />
          <StatCard icon={GitBranch} label="Leads Distributed" value={data?.leadsAssigned ?? 0} />
          <StatCard icon={Clock} label="Pending Distribution" value={data?.pendingDistribution ?? 0} />
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Salesperson Performance</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Salesperson</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Leads</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Calls</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Site Visits</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Bookings</th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {!data?.salespersonPerformance?.length ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No salesperson data yet</td></tr>
              ) : data.salespersonPerformance.map((p: any) => (
                <tr key={p.userId} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-medium text-foreground">{p.userName}</td>
                  <td className="p-3 text-muted-foreground">{p.leadsAssigned}</td>
                  <td className="p-3 text-muted-foreground">{p.callsMade}</td>
                  <td className="p-3 text-muted-foreground">{p.siteVisits}</td>
                  <td className="p-3 text-muted-foreground">{p.bookings}</td>
                  <td className="p-3 text-muted-foreground">{p.conversionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default SaTeamLeadDashboard;