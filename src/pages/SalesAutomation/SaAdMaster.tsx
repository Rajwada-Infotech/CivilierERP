import React from "react";
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

const API = "/api/sa/ads";

async function fetchAds(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch ads");
  return res.json();
}

async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth(`${API}/campaigns`);
  if (!res.ok) throw new Error("Failed to fetch campaigns");
  const data: { Id: number; Name: string; CampaignCode: string }[] = await res.json();
  return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
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
  { name: "spent", label: "Amount Spent (Rs)", type: "number" },
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
  { key: "spent", label: "Spent (Rs)", hideOnMobile: true },
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
  { header: "Spent", accessor: "spent" },
  { header: "Running Since", accessor: "runningSince" },
  { header: "Status", accessor: "status" },
];

const SaAdMaster: React.FC = () => {
  const queryClient = useQueryClient();

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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Ad Master"]} />
      <div className="space-y-8 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Ad Master</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage advertisements running under each campaign</p>
        </div>
        <MasterPage
          title="Ad"
          fields={fields}
          columns={columns}
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
              { key: "spent", label: "Amount Spent (Rs)" },
              { key: "runningSince", label: "Running Since" },
              { key: "status", label: "Status" },
              { key: "isActive", label: "Active" },
            ],
          }}
        />
      </div>
    </>
  );
};

export default SaAdMaster;