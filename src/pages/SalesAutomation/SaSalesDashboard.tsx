import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Users, PhoneCall, Flame, MapPin, Award, Percent } from "lucide-react";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { SaDashboardNav } from "@/components/sa/SaDashboardNav";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";

async function fetchSalesDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/sales");
  if (!res.ok) throw new Error("Failed to fetch sales dashboard");
  return res.json().catch(() => ({}));
}

const SaSalesDashboard: React.FC = () => {
  usePageRights("sa-leads");
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-sales"], queryFn: fetchSalesDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  // Every card used to be a dead end — SalesAutoGlassCard already supports
  // onClick, it just went unused here. Drill-downs land on the page that
  // actually shows the underlying rows.
  return (
    <SalesAutoShell title="Sales Dashboard" subtitle="Scope: this team's own lead pipeline, classification, and conversion — campaign spend/ROI lives on Marketing, distribution fairness on Team Lead" icon={Users}>
      <Breadcrumbs items={["Sales Automation", "Sales Dashboard"]} />
      <div className="space-y-6">
        <SaDashboardNav active="sales" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SalesAutoGlassCard icon={Users} label="Total Leads" value={data?.totalLeads ?? 0} onClick={() => navigate("/sales-automation/leads")} />
          <SalesAutoGlassCard icon={Users} label="Pending (New)" value={data?.pendingLeads ?? 0} onClick={() => navigate("/sales-automation/leads")} />
          <SalesAutoGlassCard icon={Users} label="Assigned" value={data?.assignedLeads ?? 0} onClick={() => navigate("/sales-automation/leads")} />
          <SalesAutoGlassCard icon={PhoneCall} label="Contacted" value={data?.contactedLeads ?? 0} onClick={() => navigate("/sales-automation/lead-activities")} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <SalesAutoGlassCard icon={Flame} label="Hot Leads" value={data?.hotLeads ?? 0} accentColor="#ef4444" onClick={() => navigate("/sales-automation/leads")} />
          <SalesAutoGlassCard icon={Flame} label="Warm Leads" value={data?.warmLeads ?? 0} accentColor="#f97316" onClick={() => navigate("/sales-automation/leads")} />
          <SalesAutoGlassCard icon={Flame} label="Cold Leads" value={data?.coldLeads ?? 0} accentColor="#3b82f6" onClick={() => navigate("/sales-automation/leads")} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <SalesAutoGlassCard icon={MapPin} label="Site Visits Scheduled" value={data?.siteVisitsScheduled ?? 0} onClick={() => navigate("/sales-automation/site-visits")} />
          <SalesAutoGlassCard icon={MapPin} label="Site Visits Completed" value={data?.siteVisitsCompleted ?? 0} onClick={() => navigate("/sales-automation/site-visits")} />
          <SalesAutoGlassCard icon={Award} label="Bookings Generated" value={data?.bookingsGenerated ?? 0} onClick={() => navigate("/sales-automation/pipeline")} />
        </div>

        <MonthlyLeadTrend />

        <SalesAutoGlassCard icon={Percent} label="Overall Conversion Rate" value={`${data?.conversionPercentage ?? 0}%`} accentColor="#22c55e" />
      </div>
    </SalesAutoShell>
  );
};

export default SaSalesDashboard;