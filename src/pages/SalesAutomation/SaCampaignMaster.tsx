import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { CodeCell, CountCell, fmtPct, MoneyCell, MoneyView, PctView, StatusCell, TitleCell } from "@/components/sa/saCells";
import { formatINR } from "@/utils/formatCurrency";
import { Megaphone, Wallet, Receipt, Users } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
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
  { name: "name", label: "Campaign Name", type: "text", required: true, placeholder: "e.g. Diwali Launch – Silver Woods" },
  {
    name: "platformId",
    label: "Platform",
    type: "select",
    required: true,
    asyncOptions: fetchPlatformOptions,
  },
  { name: "campaignCode", label: "Code", type: "text", uppercase: true, placeholder: "Leave blank to auto-assign" },
  { name: "marketingManagerId", label: "Marketing Manager", type: "select", asyncOptions: fetchManagerOptions },
  { name: "startDate", label: "Starts On", type: "date" },
  { name: "endDate", label: "Ends On", type: "date" },
  { name: "budget", label: "Budget", type: "number", prefix: "₹" },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Paused", "Completed", "Cancelled"],
    defaultValue: "Active",
  },
  // No "Active" switch: Status says whether the campaign is running.
  // IsActive is the delete flag, set by Delete — an edit sends back the
  // value it loaded.
  { name: "objective", label: "Objective", type: "textarea", fullWidth: true, placeholder: "What this campaign should achieve — e.g. 200 site-visit leads for 3BHK units by March" },
];

const columns = [
  { key: "campaignCode", label: "Code" },
  { key: "name", label: "Campaign" },
  { key: "platformName", label: "Platform", hideOnMobile: true },
  { key: "budget", label: "Budget", hideOnMobile: true },
  { key: "costSpent", label: "Spent", hideOnMobile: true },
  { key: "totalAds", label: "Ads", hideOnMobile: true },
  { key: "totalLeads", label: "Leads" },
  { key: "costPerLead", label: "Cost / Lead", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const dateRange = (row: RecordWithId) => {
  const fmt = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
  const s = fmt(row.startDate), e = fmt(row.endDate);
  return s || e ? `${s || "…"} – ${e || "ongoing"}` : "";
};

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
  // Pre-filter when arriving from Social Media Master's "N campaigns" link.
  const [searchParams] = useSearchParams();
  const platformFilter = searchParams.get("platformId");

  const { data: campaigns, isLoading, error } = useQuery({
    queryKey: ["sa-campaigns"],
    queryFn: fetchCampaigns,
    staleTime: 5 * 60 * 1000,
  });

  const allMappedData: RecordWithId[] = React.useMemo(() => {
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

  const mappedData = React.useMemo(
    () => platformFilter ? allMappedData.filter((c) => c.platformId === platformFilter) : allMappedData,
    [allMappedData, platformFilter],
  );

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
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Campaigns"]} title="Campaigns">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load campaigns. Refresh the page to try again." : "Loading campaigns…"}
      </div>
    </SalesAutoShell>
  );

  const live = mappedData.filter((c) => c.status === "Active" && c.isActive !== false);
  const totalBudget = mappedData.reduce((s, c) => s + Number(c.budget ?? 0), 0);
  const totalSpent = mappedData.reduce((s, c) => s + Number(c.costSpent ?? 0), 0);
  const totalLeads = mappedData.reduce((s, c) => s + Number(c.totalLeads ?? 0), 0);

  return (
    <SalesAutoShell
      breadcrumbs={["Sales Automation", "Campaigns"]}
      title="Campaigns"
      subtitle={platformFilter ? `Campaigns on ${mappedData[0]?.platformName || "the selected platform"}`
        : `${mappedData.length} campaign${mappedData.length === 1 ? "" : "s"}, ${live.length} running — each holds the ads you run on one platform`}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SalesAutoGlassCard label="Running" value={live.length} sub={`of ${mappedData.length} campaigns`} icon={Megaphone} accentColor="#2563eb" />
          <SalesAutoGlassCard label="Budget" value={formatINR(totalBudget)} icon={Wallet} accentColor="#0891b2" />
          <SalesAutoGlassCard label="Spent" value={formatINR(totalSpent)} sub={totalBudget ? `${fmtPct((totalSpent / totalBudget) * 100)} of budget` : undefined} icon={Receipt} accentColor="#ea580c" />
          <SalesAutoGlassCard label="Leads" value={totalLeads} sub={totalLeads ? `${formatINR(totalSpent / totalLeads)} per lead` : undefined} icon={Users} accentColor="#7c3aed" />
        </div>
        {platformFilter && (
          <Link to="/sales-automation/campaigns" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            ← Clear platform filter, show all campaigns
          </Link>
        )}
        <MasterPage
          title="Campaign"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          columnRenderers={{
            campaignCode: CodeCell,
            name: (v, row) => TitleCell(v, dateRange(row) || row.marketingManagerName),
            budget: MoneyCell,
            costSpent: MoneyCell,
            costPerLead: MoneyCell,
            totalLeads: CountCell,
            status: StatusCell,
            totalAds: (value, row) => (
              <Link to={`/sales-automation/ads?campaignId=${row._id}`} className="text-primary hover:underline whitespace-nowrap">
                {String(value)} ad{Number(value) === 1 ? "" : "s"} →
              </Link>
            ),
          }}
          canCreate={canDoAction("sa-campaigns", "create")}
          canEdit={canDoAction("sa-campaigns", "edit")}
          canDelete={canDoAction("sa-campaigns", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Campaigns",
            filename: "campaign-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Campaign Details",
            fields: [
              { key: "campaignCode", label: "Code" },
              { key: "name", label: "Campaign" },
              { key: "platformName", label: "Platform" },
              { key: "marketingManagerName", label: "Marketing Manager" },
              { key: "startDate", label: "Starts On" },
              { key: "endDate", label: "Ends On" },
              { key: "activeDays", label: "Days Running" },
              { key: "budget", label: "Budget", render: MoneyView },
              { key: "costSpent", label: "Spent", render: MoneyView },
              { key: "totalAds", label: "Ads" },
              { key: "totalLeads", label: "Leads" },
              { key: "costPerLead", label: "Cost / Lead", render: MoneyView },
              { key: "conversionPct", label: "Conversion", render: PctView },
              { key: "objective", label: "Objective" },
              { key: "status", label: "Status", render: (v) => StatusCell(v) },
              { key: "isActive", label: "Active" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaCampaignMaster;
