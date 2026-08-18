import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Megaphone, TrendingUp, IndianRupee, Target, Award } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";

async function fetchMarketingDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/marketing");
  if (!res.ok) throw new Error("Failed to fetch marketing dashboard");
  return res.json().catch(() => ({}));
}

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number; sub?: string }> = ({ icon: Icon, label, value, sub }) => (
  <div className="rounded-lg border border-border p-4 flex items-start gap-3">
    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
      <Icon size={18} />
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  </div>
);

const SaMarketingDashboard: React.FC = () => {
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-marketing"], queryFn: fetchMarketingDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  return (
    <SalesAutoShell title="Marketing Dashboard" subtitle="Campaign performance, spend, and lead generation overview" icon={Megaphone}>
      <div className="space-y-6">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Megaphone} label="Total Campaigns" value={data?.totalCampaigns ?? 0} />
          <StatCard icon={TrendingUp} label="Active Ads" value={data?.activeAds ?? 0} />
          <StatCard icon={Target} label="Total Leads" value={data?.totalLeads ?? 0} />
          <StatCard icon={IndianRupee} label="Marketing Spend" value={`?${(data?.marketingSpend ?? 0).toLocaleString()}`} />
          <StatCard icon={IndianRupee} label="Cost Per Lead" value={`?${data?.costPerLead ?? 0}`} />
          <StatCard icon={IndianRupee} label="Invoices Paid" value={`?${(data?.invoicedPaid ?? 0).toLocaleString()}`} />
          <StatCard icon={IndianRupee} label="Revenue Generated" value={`?${(data?.revenueGenerated ?? 0).toLocaleString()}`} />
          <StatCard icon={TrendingUp} label="ROI" value={`${data?.roi ?? 0}%`} />
          <StatCard icon={Award} label="Bookings Generated" value={data?.bookingsGenerated ?? 0} />
        </div>

        <MonthlyLeadTrend />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Best Performing Campaign</h3>
            {data?.bestCampaign ? (
              <div>
                <p className="text-base font-medium text-foreground">{data.bestCampaign.Name}</p>
                <p className="text-xs text-muted-foreground">{data.bestCampaign.CampaignCode} � {data.bestCampaign.LeadCount} leads</p>
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
    </SalesAutoShell>
  );
};

export default SaMarketingDashboard;
