import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Users, PhoneCall, Flame, MapPin, Award, Percent, Megaphone, TrendingUp, IndianRupee, Target, GitBranch, Clock, LayoutDashboard } from "lucide-react";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { SaTabs } from "@/components/sa/SaTabs";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

// User's explicit instruction: "THERE SHOULD ONLY ONE DASHBOARD" — the
// module previously had 3 separate sidebar entries/routes/pages (Sales,
// Marketing, Team Lead), each a real distinct scope but presented as 3
// unrelated top-level destinations. Now one page, one sidebar entry, one
// route — the 3 scopes become tabs within it instead of being 3 places to
// navigate to. All 3 views' data/drill-downs are unchanged from before.

async function fetchSalesDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/sales");
  if (!res.ok) throw new Error("Failed to fetch sales dashboard");
  return res.json().catch(() => ({}));
}
async function fetchMarketingDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/marketing");
  if (!res.ok) throw new Error("Failed to fetch marketing dashboard");
  return res.json().catch(() => ({}));
}
async function fetchTeamLeadDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/team-lead");
  if (!res.ok) throw new Error("Failed to fetch team lead dashboard");
  return res.json().catch(() => ({}));
}

const SalesView: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-sales"], queryFn: fetchSalesDashboard, staleTime: 60_000 });
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load.</div>;
  return (
    <div className="space-y-6">
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
  );
};

const MarketingView: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-marketing"], queryFn: fetchMarketingDashboard, staleTime: 60_000 });
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load.</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SalesAutoGlassCard icon={Megaphone} label="Total Campaigns" value={data?.totalCampaigns ?? 0} onClick={() => navigate("/sales-automation/campaigns")} />
        <SalesAutoGlassCard icon={TrendingUp} label="Active Ads" value={data?.activeAds ?? 0} onClick={() => navigate("/sales-automation/ads")} />
        <SalesAutoGlassCard icon={Target} label="Total Leads" value={data?.totalLeads ?? 0} onClick={() => navigate("/sales-automation/leads")} />
        <SalesAutoGlassCard icon={IndianRupee} label="Marketing Spend" value={`₹${(data?.marketingSpend ?? 0).toLocaleString()}`} onClick={() => navigate("/sales-automation/invoices")} />
        <SalesAutoGlassCard icon={IndianRupee} label="Cost Per Lead" value={`₹${data?.costPerLead ?? 0}`} />
        <SalesAutoGlassCard icon={IndianRupee} label="Invoices Paid" value={`₹${(data?.invoicedPaid ?? 0).toLocaleString()}`} onClick={() => navigate("/sales-automation/invoices")} />
        <SalesAutoGlassCard icon={IndianRupee} label="Revenue Generated" value={`₹${(data?.revenueGenerated ?? 0).toLocaleString()}`} />
        <SalesAutoGlassCard icon={TrendingUp} label="ROI" value={`${data?.roi ?? 0}%`} />
        <SalesAutoGlassCard icon={Award} label="Bookings Generated" value={data?.bookingsGenerated ?? 0} onClick={() => navigate("/sales-automation/pipeline")} />
      </div>
      <MonthlyLeadTrend />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Best Performing Campaign</h3>
          {data?.bestCampaign ? (
            <div>
              <p className="text-base font-medium text-foreground">{data.bestCampaign.Name}</p>
              <p className="text-xs text-muted-foreground">{data.bestCampaign.CampaignCode} — {data.bestCampaign.LeadCount} leads</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">No campaign data yet</p>}
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Best Performing Advertisement</h3>
          {data?.bestAd ? (
            <div>
              <p className="text-base font-medium text-foreground">{data.bestAd.Name}</p>
              <p className="text-xs text-muted-foreground">{data.bestAd.LeadCount} leads generated</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">No ad data yet</p>}
        </div>
      </div>
    </div>
  );
};

const TeamLeadView: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-team-lead"], queryFn: fetchTeamLeadDashboard, staleTime: 60_000 });
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load.</div>;

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
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <SalesAutoGlassCard icon={Users} label="Leads Received" value={data?.leadsReceived ?? 0} onClick={() => navigate("/sales-automation/leads")} />
        <SalesAutoGlassCard icon={GitBranch} label="Leads Distributed" value={data?.leadsAssigned ?? 0} onClick={() => navigate("/sales-automation/distribution")} />
        <SalesAutoGlassCard icon={Clock} label="Pending Distribution" value={data?.pendingDistribution ?? 0} onClick={() => navigate("/sales-automation/distribution")} />
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
  );
};

const SUBTITLES: Record<string, string> = {
  sales: "This team's own lead pipeline, classification, and conversion",
  marketing: "Campaign spend, ROI, and lead generation across channels",
  "team-lead": "Lead distribution and salesperson performance",
};

const SaDashboard: React.FC = () => {
  usePageRights("sa-leads");
  const [view, setView] = useState<"sales" | "marketing" | "team-lead">("sales");

  return (
    <SalesAutoShell title="Dashboard" subtitle={SUBTITLES[view]} icon={LayoutDashboard}>
      <Breadcrumbs items={["Sales Automation", "Dashboard"]} />
      <div className="space-y-6">
        <SaTabs
          tabs={[
            { key: "sales", label: "Sales", icon: Users },
            { key: "marketing", label: "Marketing", icon: Megaphone },
            { key: "team-lead", label: "Team Lead", icon: GitBranch },
          ]}
          active={view}
          onChange={(key) => setView(key)}
        />
        {view === "sales" && <SalesView />}
        {view === "marketing" && <MarketingView />}
        {view === "team-lead" && <TeamLeadView />}
      </div>
    </SalesAutoShell>
  );
};

export default SaDashboard;
