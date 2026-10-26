import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Megaphone, TrendingUp, IndianRupee, Target, Award } from "lucide-react";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { SaDashboardNav } from "@/components/sa/SaDashboardNav";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MonthlyLeadTrend } from "@/components/sa/MonthlyLeadTrend";

async function fetchMarketingDashboard(): Promise<any> {
  const res = await fetchWithAuth("/api/sa/dashboard/marketing");
  if (!res.ok) throw new Error("Failed to fetch marketing dashboard");
  return res.json().catch(() => ({}));
}

const SaMarketingDashboard: React.FC = () => {
  usePageRights("sa-campaigns");
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["sa-dashboard-marketing"], queryFn: fetchMarketingDashboard, staleTime: 60_000 });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load dashboard.</div>;

  return (
    <SalesAutoShell title="Marketing Dashboard" subtitle="Scope: campaign spend, ROI, and lead generation across channels — lead pipeline/conversion lives on Sales, distribution fairness on Team Lead" icon={Megaphone}>
      <Breadcrumbs items={["Sales Automation", "Marketing Dashboard"]} />
      <div className="space-y-6">
        <SaDashboardNav active="marketing" />

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
    </SalesAutoShell>
  );
};

export default SaMarketingDashboard;
