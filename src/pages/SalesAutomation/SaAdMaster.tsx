import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LayoutList, BarChart2 } from "lucide-react";

const API = "/api/sa/ads";

async function fetchAds(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch ads");
  return res.json().catch(() => ({}));
}

async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${API}/campaigns`);
    if (!res.ok) return [];
    const data: { Id: number; Name: string; CampaignCode: string }[] = await res.json();
    return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  {
    name: "campaignId",
    label: "Campaign",
    type: "select",
    required: true,
    asyncOptions: fetchCampaignOptions,
  },
  { name: "name", label: "Ad Name", type: "text", required: true },
  {
    name: "adType",
    label: "Ad Type",
    type: "select",
    options: ["Image", "Video", "Carousel", "Story", "Reel", "Search", "Display", "Other"],
  },
  { name: "creativeRef", label: "Creative Reference", type: "text" },
  { name: "budget", label: "Budget (Rs)", type: "number" },
  { name: "dailySpend", label: "Daily Spend (Rs)", type: "number" },
  { name: "spent", label: "Fallback Spend (Rs)", type: "number" },
  { name: "runningSince", label: "Running Since", type: "date" },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Paused", "Completed", "Cancelled"],
    defaultValue: "Active",
  },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "name", label: "Ad Name" },
  { key: "campaignName", label: "Campaign" },
  { key: "adType", label: "Type", hideOnMobile: true },
  { key: "budget", label: "Budget (Rs)", hideOnMobile: true },
  { key: "costSpent", label: "Cost Spent (Rs)", hideOnMobile: true },
  { key: "totalLeadsGenerated", label: "Leads", hideOnMobile: true },
  { key: "costPerLead", label: "CPL (Rs)", hideOnMobile: true },
  { key: "conversionRate", label: "Conv. %", hideOnMobile: true },
  { key: "roi", label: "ROI %", hideOnMobile: true },
  { key: "status", label: "Status" },
  { key: "isActive", label: "Active" },
];

const exportColumns: ExportColumn[] = [
  { header: "Ad Name", accessor: "name" },
  { header: "Campaign", accessor: "campaignName" },
  { header: "Ad Type", accessor: "adType" },
  { header: "Creative Ref", accessor: "creativeRef" },
  { header: "Budget", accessor: "budget" },
  { header: "Daily Spend", accessor: "dailySpend" },
  { header: "Fallback Spend", accessor: "spent" },
  { header: "Cost Spent", accessor: "costSpent" },
  { header: "Invoice Count", accessor: "invoiceCount" },
  { header: "Total Leads Generated", accessor: "totalLeadsGenerated" },
  { header: "Cost Per Lead", accessor: "costPerLead" },
  { header: "Conversion Rate", accessor: "conversionRate" },
  { header: "Booking Count", accessor: "bookingCount" },
  { header: "Revenue Generated", accessor: "revenueGenerated" },
  { header: "ROI", accessor: "roi" },
  { header: "Running Since", accessor: "runningSince" },
  { header: "Status", accessor: "status" },
];

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const SaAdMaster: React.FC = () => {
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"list" | "performance">("list");

  const { data: ads, isLoading, error } = useQuery({
    queryKey: ["sa-ads"],
    queryFn: fetchAds,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(ads)) return [];
    return ads.map((item) => ({
      _id: String(item.Id),
      campaignId: String(item.CampaignId ?? ""),
      campaignName: item.CampaignName ?? "",
      name: item.Name ?? "",
      adType: item.AdType ?? "",
      creativeRef: item.CreativeRef ?? "",
      budget: item.Budget ?? 0,
      dailySpend: item.DailySpend ?? 0,
      spent: item.Spent ?? 0,
      costSpent: toNumber(item.CostSpent),
      invoiceCount: item.InvoiceCount ?? 0,
      totalLeadsGenerated: item.TotalLeadsGenerated ?? 0,
      costPerLead: toNumber(item.CostPerLead),
      conversionRate: toNumber(item.ConversionRate),
      bookingCount: item.BookingCount ?? 0,
      revenueGenerated: toNumber(item.RevenueGenerated),
      roi: toNumber(item.ROI),
      runningSince: item.RunningSince ? String(item.RunningSince).slice(0, 10) : "",
      status: item.Status ?? "Active",
      isActive: Boolean(item.IsActive),
    }));
  }, [ads]);

  const toPayload = (r: Record<string, any>) => ({
    CampaignId: r.campaignId ? parseInt(r.campaignId) : null,
    Name: r.name?.trim() || null,
    AdType: r.adType || null,
    CreativeRef: r.creativeRef || null,
    Budget: r.budget ? parseFloat(r.budget) : 0,
    DailySpend: r.dailySpend ? parseFloat(r.dailySpend) : 0,
    Spent: r.spent ? parseFloat(r.spent) : 0,
    RunningSince: r.runningSince || null,
    Status: r.status || "Active",
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add ad");
        toast.success("Ad added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update ad");
        toast.success("Ad updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete ad");
        toast.success("Ad deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-ads"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading ads...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load ads.</div>;

  const totalBudget = mappedData.reduce((s, a) => s + Number(a.budget ?? 0), 0);
  const totalSpent = mappedData.reduce((s, a) => s + Number(a.costSpent ?? 0), 0);
  const totalLeads = mappedData.reduce((s, a) => s + Number(a.totalLeadsGenerated ?? 0), 0);
  const totalBookings = mappedData.reduce((s, a) => s + Number(a.bookingCount ?? 0), 0);
  const totalRevenue = mappedData.reduce((s, a) => s + Number(a.revenueGenerated ?? 0), 0);
  const avgROI = mappedData.filter((a) => Number(a.roi) !== 0).length
    ? mappedData.reduce((s, a) => s + Number(a.roi ?? 0), 0) / mappedData.filter((a) => Number(a.roi) !== 0).length
    : 0;

  const fmtRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Ad Master"]} />
      <div className="space-y-6 mt-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">Ad Master</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage advertisements running under each campaign</p>
          </div>
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            {([
              { key: "list", icon: LayoutList, label: "List" },
              { key: "performance", icon: BarChart2, label: "Performance" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* PERFORMANCE TAB */}
        {activeTab === "performance" && (
          <div className="space-y-6">
            {/* Summary KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                { label: "Total Budget", value: fmtRs(totalBudget), color: "text-blue-600" },
                { label: "Total Spent", value: fmtRs(totalSpent), color: "text-orange-600" },
                { label: "Total Leads", value: String(totalLeads), color: "text-purple-600" },
                { label: "Total Bookings", value: String(totalBookings), color: "text-emerald-600" },
                { label: "Revenue", value: fmtRs(totalRevenue), color: "text-green-600" },
                { label: "Avg ROI", value: fmtPct(avgROI), color: avgROI >= 0 ? "text-emerald-600" : "text-red-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-border bg-card p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Per-ad performance table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Performance by Ad</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr>
                      {["Ad Name", "Campaign", "Budget", "Spent", "Leads", "CPL", "Conv %", "Bookings", "Revenue", "ROI %"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedData.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-muted-foreground text-sm">No ads found</td></tr>
                    ) : mappedData.map((ad) => {
                      const roi = Number(ad.roi ?? 0);
                      return (
                        <tr key={String(ad._id)} className="border-t border-border hover:bg-muted/10 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{String(ad.name)}</td>
                          <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{String(ad.campaignName)}</td>
                          <td className="px-3 py-2.5 text-muted-foreground text-xs">{fmtRs(Number(ad.budget ?? 0))}</td>
                          <td className="px-3 py-2.5 text-orange-600 text-xs">{fmtRs(Number(ad.costSpent ?? 0))}</td>
                          <td className="px-3 py-2.5 text-center font-semibold">{String(ad.totalLeadsGenerated ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">{Number(ad.costPerLead) > 0 ? fmtRs(Number(ad.costPerLead)) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{fmtPct(Number(ad.conversionRate ?? 0))}</td>
                          <td className="px-3 py-2.5 text-center font-semibold text-emerald-600">{String(ad.bookingCount ?? 0)}</td>
                          <td className="px-3 py-2.5 text-xs text-green-600">{Number(ad.revenueGenerated) > 0 ? fmtRs(Number(ad.revenueGenerated)) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className={`font-semibold ${roi >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtPct(roi)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* LIST TAB */}
        {activeTab === "list" && <MasterPage
          title="Ad"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-ads", "create")}
          canEdit={canDoAction("sa-ads", "edit")}
          canDelete={canDoAction("sa-ads", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Ad Master",
            filename: "ad-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Ad Details",
            fields: [
              { key: "name", label: "Ad Name" },
              { key: "campaignName", label: "Campaign" },
              { key: "adType", label: "Ad Type" },
              { key: "creativeRef", label: "Creative Reference" },
              { key: "budget", label: "Budget (Rs)" },
              { key: "dailySpend", label: "Daily Spend (Rs)" },
              { key: "spent", label: "Fallback Spend (Rs)" },
              { key: "costSpent", label: "Cost Spent (Rs)" },
              { key: "invoiceCount", label: "Linked Invoices" },
              { key: "totalLeadsGenerated", label: "Total Leads Generated" },
              { key: "costPerLead", label: "Cost Per Lead (Rs)" },
              { key: "conversionRate", label: "Conversion Rate %" },
              { key: "bookingCount", label: "Booking Count" },
              { key: "revenueGenerated", label: "Revenue Generated (Rs)" },
              { key: "roi", label: "ROI %" },
              { key: "runningSince", label: "Running Since" },
              { key: "status", label: "Status" },
              { key: "isActive", label: "Active" },
            ],
          }}
        />}
      </div>
    </>
  );
};

export default SaAdMaster;
