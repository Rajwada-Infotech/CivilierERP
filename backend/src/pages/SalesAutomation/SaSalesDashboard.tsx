import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Users, PhoneCall, Flame, MapPin, Award, Percent } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";

async function fetchSalesDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/sales");
  if (!res.ok) throw new Error("Failed to fetch sales dashboard");
  return res.json().catch(() => ({}));
}

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number; tone?: string }> = ({ icon: Icon, label, value, tone }) => (
  <div className="rounded-lg border border-border p-4 flex items-start gap-3">
    <div className={`p-2 rounded-lg shrink-0 ${tone || "bg-primary/10 text-primary"}`}>
      <Icon size={18} />
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground mt-0.5">{value}</p>
    </div>
  </div>
);

const SaSalesDashboard: React.FC = () => {
  usePageRights("sa-leads");
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-sales"], queryFn: fetchSalesDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  return (
    <SalesAutoShell title="Sales Dashboard" subtitle="Lead pipeline, classification, and conversion overview" icon={Users}>
      <Breadcrumbs items={["Sales Automation", "Sales Dashboard"]} />
      <div className="space-y-6">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Total Leads" value={data?.totalLeads ?? 0} />
          <StatCard icon={Users} label="Pending (New)" value={data?.pendingLeads ?? 0} />
          <StatCard icon={Users} label="Assigned" value={data?.assignedLeads ?? 0} />
          <StatCard icon={PhoneCall} label="Contacted" value={data?.contactedLeads ?? 0} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Flame} label="Hot Leads" value={data?.hotLeads ?? 0} tone="bg-red-500/10 text-red-500" />
          <StatCard icon={Flame} label="Warm Leads" value={data?.warmLeads ?? 0} tone="bg-orange-500/10 text-orange-500" />
          <StatCard icon={Flame} label="Cold Leads" value={data?.coldLeads ?? 0} tone="bg-blue-500/10 text-blue-500" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard icon={MapPin} label="Site Visits Scheduled" value={data?.siteVisitsScheduled ?? 0} />
          <StatCard icon={MapPin} label="Site Visits Completed" value={data?.siteVisitsCompleted ?? 0} />
          <StatCard icon={Award} label="Bookings Generated" value={data?.bookingsGenerated ?? 0} />
        </div>

        <MonthlyLeadTrend />

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
              <Percent size={18} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Overall Conversion Rate</p>
              <p className="text-xl font-bold text-foreground">{data?.conversionPercentage ?? 0}%</p>
            </div>
          </div>
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaSalesDashboard;