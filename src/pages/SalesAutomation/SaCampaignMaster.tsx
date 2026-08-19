import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/sa/campaigns";

async function fetchCampaigns(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch campaigns");
  return res.json().catch(() => ({}));
}

async function fetchPlatformOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/social-media");
    if (!res.ok) return [];
    const data: { Id: number; Name: string }[] = await res.json();
    return data.map((p) => ({ value: String(p.Id), label: p.Name }));
  } catch { return []; }
}
async function fetchManagerOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/leads/users");
    if (!res.ok) return [];
    const data: { Id: number; Name: string; role: string }[] = await res.json();
    return data.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  { name: "campaignCode", label: "Campaign Code (auto-assigned if left blank)", type: "text", uppercase: true },
  { name: "name", label: "Campaign Name", type: "text", required: true },
  {
    name: "platformId",
    label: "Social Media Platform",
    type: "select",
    required: true,
    asyncOptions: fetchPlatformOptions,
  },
  { name: "objective", label: "Campaign Objective", type: "textarea", fullWidth: true },
  { name: "startDate", label: "Start Date", type: "date" },
  { name: "endDate", label: "End Date", type: "date" },
  { name: "budget", label: "Budget (Rs)", type: "number" },
  {
    name: "status",
    label: "Campaign Status",
    type: "select",
    options: ["Active", "Paused", "Completed", "Cancelled"],
    defaultValue: "Active",
  },
  { name: "marketingManagerId", label: "Marketing Manager", type: "select", asyncOptions: fetchManagerOptions },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "campaignCode", label: "Code" },
  { key: "name", label: "Campaign Name" },
  { key: "platformName", label: "Platform" },
  { key: "budget", label: "Budget (Rs)", hideOnMobile: true },
  { key: "totalAds", label: "Ads", hideOnMobile: true },
  { key: "totalLeads", label: "Leads", hideOnMobile: true },
  { key: "costSpent", label: "Spent (Rs)", hideOnMobile: true },
  { key: "costPerLead", label: "CPL (Rs)", hideOnMobile: true },
  { key: "marketingManagerName", label: "Manager", hideOnMobile: true },
  { key: "status", label: "Status" },
  { key: "isActive", label: "Active" },
];

const exportColumns: ExportColumn[] = [
  { header: "Code", accessor: "campaignCode" },
  { header: "Campaign Name", accessor: "name" },
  { header: "Platform", accessor: "platformName" },
  { header: "Budget", accessor: "budget" },
  { header: "Total Ads", accessor: "totalAds" },
  { header: "Total Leads", accessor: "totalLeads" },
  { header: "Spent", accessor: "costSpent" },
  { header: "Cost Per Lead", accessor: "costPerLead" },
  { header: "Conversion %", accessor: "conversionPct" },
  { header: "Active Days", accessor: "activeDays" },
  { header: "Status", accessor: "status" },
];

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const SaCampaignMaster: React.FC = () => {
  usePageRights("sa-campaigns");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading, error } = useQuery({
    queryKey: ["sa-campaigns"],
    queryFn: fetchCampaigns,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(campaigns)) return [];
    return campaigns.map((item) => ({
      _id: String(item.Id),
      campaignCode: item.CampaignCode ?? "",
      name: item.Name ?? "",
      platformId: String(item.PlatformId ?? ""),
      platformName: item.PlatformName ?? "",
      marketingManagerId: String(item.MarketingManagerId ?? ""),
      marketingManagerName: item.MarketingManagerName ?? "",
      objective: item.Objective ?? "",
      startDate: item.StartDate ? String(item.StartDate).slice(0, 10) : "",
      endDate: item.EndDate ? String(item.EndDate).slice(0, 10) : "",
      budget: item.Budget ?? 0,
      status: item.Status ?? "Active",
      isActive: Boolean(item.IsActive),
      totalAds: item.TotalAds ?? 0,
      totalLeads: item.TotalLeads ?? 0,
      costSpent: toNumber(item.CostSpent),
      costPerLead: toNumber(item.CostPerLead),
      conversionPct: toNumber(item.ConversionPct),
      activeDays: item.ActiveDays ?? "",
    }));
  }, [campaigns]);

  const toPayload = (r: Record<string, any>) => ({
    CampaignCode: r.campaignCode?.trim() || null,
    Name: r.name?.trim() || null,
    PlatformId: r.platformId ? parseInt(r.platformId) : null,
    Objective: r.objective || null,
    StartDate: r.startDate || null,
    EndDate: r.endDate || null,
    Budget: r.budget ? parseFloat(r.budget) : 0,
    Status: r.status || "Active",
    MarketingManagerId: r.marketingManagerId ? parseInt(r.marketingManagerId) : null,
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
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add campaign");
        toast.success("Campaign added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update campaign");
        toast.success("Campaign updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete campaign");
        toast.success("Campaign deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-campaigns"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading campaigns...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load campaigns.</div>;

  return (
    <SalesAutoShell title="Campaign Master" subtitle="Manage marketing campaigns across all social media platforms">
      <Breadcrumbs items={["Sales Automation", "Campaign Master"]} />
      <div className="space-y-8">
        <MasterPage
          title="Campaign"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-campaigns", "create")}
          canEdit={canDoAction("sa-campaigns", "edit")}
          canDelete={canDoAction("sa-campaigns", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Campaign Master",
            filename: "campaign-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Campaign Details",
            fields: [
              { key: "campaignCode", label: "Campaign Code" },
              { key: "name", label: "Campaign Name" },
              { key: "platformName", label: "Platform" },
              { key: "objective", label: "Objective" },
              { key: "startDate", label: "Start Date" },
              { key: "endDate", label: "End Date" },
              { key: "budget", label: "Budget (Rs)" },
              { key: "totalAds", label: "Total Ads" },
              { key: "totalLeads", label: "Total Leads" },
              { key: "costSpent", label: "Cost Spent (Rs)" },
              { key: "costPerLead", label: "Cost Per Lead (Rs)" },
              { key: "conversionPct", label: "Conversion %" },
              { key: "activeDays", label: "Active Days" },
              { key: "marketingManagerName", label: "Marketing Manager" },
              { key: "status", label: "Status" },
              { key: "isActive", label: "Active" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaCampaignMaster;
