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
import { PlugZap } from "lucide-react";

const API = "/api/sa/social-media";

async function fetchPlatforms(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch social media platforms");
  return res.json().catch(() => ({}));
}

async function fetchApiConfigOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${API}/api-configs`);
    if (!res.ok) return [];
    const data: { Id: number; ChannelKey: string; Label: string }[] = await res.json();
    return data.map((c) => ({ value: String(c.Id), label: `${c.Label} (${c.ChannelKey})` }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  { name: "name", label: "Platform Name", type: "text", required: true },
  {
    name: "platformType",
    label: "Platform Type",
    type: "select",
    options: ["Facebook", "Instagram", "Google", "LinkedIn", "YouTube", "WhatsApp", "SMS", "Email Marketing", "Other"],
  },
  { name: "accountDetails", label: "Account Details", type: "textarea", fullWidth: true },
  { name: "apiConfigId", label: "API Integration Channel", type: "select", asyncOptions: fetchApiConfigOptions },
  { name: "adAccountId", label: "Ad Account ID", type: "text" },
  { name: "pixelId", label: "Pixel / Conversion ID", type: "text" },
  { name: "accessToken", label: "Access Token", type: "textarea", fullWidth: true, placeholder: "Leave blank to keep existing token while editing" },
  { name: "refreshToken", label: "Refresh Token", type: "textarea", fullWidth: true, placeholder: "Optional" },
  { name: "tokenExpiresAt", label: "Token Expires At", type: "date" },
  { name: "apiEnabled", label: "API Enabled", type: "toggle", defaultValue: false },
  { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
  { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "name", label: "Platform Name" },
  { key: "platformType", label: "Type" },
  { key: "apiConfigLabel", label: "API Channel", hideOnMobile: true },
  { key: "apiEnabled", label: "API", hideOnMobile: true },
  { key: "campaignCount", label: "Campaigns" },
  { key: "activeAdCount", label: "Active Ads" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Platform Name", accessor: "name" },
  { header: "Type", accessor: "platformType" },
  { header: "API Channel", accessor: "apiConfigLabel" },
  { header: "Ad Account", accessor: "adAccountId" },
  { header: "API Enabled", accessor: "apiEnabled" },
  { header: "Campaigns", accessor: "campaignCount" },
  { header: "Active Ads", accessor: "activeAdCount" },
  { header: "Status", accessor: "isActive" },
];

const SaSocialMediaMaster: React.FC = () => {
  usePageRights("sa-social-media");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();

  const { data: platforms, isLoading, error } = useQuery({
    queryKey: ["sa-social-media"],
    queryFn: fetchPlatforms,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(platforms)) return [];
    return platforms.map((item) => ({
      _id: String(item.Id),
      name: item.Name ?? "",
      platformType: item.PlatformType ?? "",
      accountDetails: item.AccountDetails ?? "",
      apiConfigId: String(item.ApiConfigId ?? ""),
      apiConfigLabel: item.ApiConfigLabel ?? "",
      adAccountId: item.AdAccountId ?? "",
      pixelId: item.PixelId ?? "",
      accessToken: "",
      refreshToken: "",
      tokenExpiresAt: item.TokenExpiresAt ? String(item.TokenExpiresAt).slice(0, 10) : "",
      apiEnabled: Boolean(item.ApiEnabled),
      hasAccessToken: Boolean(item.HasAccessToken),
      hasRefreshToken: Boolean(item.HasRefreshToken),
      notes: item.Notes ?? "",
      isActive: Boolean(item.IsActive),
      campaignCount: item.CampaignCount ?? 0,
      activeAdCount: item.ActiveAdCount ?? 0,
    }));
  }, [platforms]);

  const toPayload = (r: Record<string, any>) => ({
    Name: r.name?.trim() || null,
    PlatformType: r.platformType || null,
    AccountDetails: r.accountDetails || null,
    Notes: r.notes || null,
    IsActive: r.isActive !== false,
  });

  const toApiPayload = (r: Record<string, any>) => ({
    ApiConfigId: r.apiConfigId ? parseInt(r.apiConfigId) : null,
    AdAccountId: r.adAccountId || null,
    PixelId: r.pixelId || null,
    AccessToken: r.accessToken || null,
    RefreshToken: r.refreshToken || null,
    TokenExpiresAt: r.tokenExpiresAt || null,
    ApiEnabled: r.apiEnabled === true,
  });

  const testConnection = async (row: RecordWithId) => {
    try {
      const res = await fetchWithAuth(`${API}/${row._id}/test-connection`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || "Connection failed");
      toast.success(data.message || "Connection successful");
    } catch (err: any) {
      toast.error(err.message || "Connection failed");
    }
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        const created = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(created.error || "Failed to add platform");
        if (created.id) {
          const apiRes = await fetchWithAuth(`${API}/${created.id}/api-config`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toApiPayload(event.record)),
          });
          if (!apiRes.ok) throw new Error((await apiRes.json()).error || "Failed to update API configuration");
        }
        toast.success("Platform added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update platform");
        const apiRes = await fetchWithAuth(`${API}/${event.id}/api-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toApiPayload(event.record)),
        });
        if (!apiRes.ok) throw new Error((await apiRes.json()).error || "Failed to update API configuration");
        toast.success("Platform updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete platform");
        toast.success("Platform deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-social-media"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading platforms...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load platforms.</div>;

  return (
    <SalesAutoShell title="Social Media Master" subtitle="Manage social media platforms and their campaign connections">
      <Breadcrumbs items={["Sales Automation", "Social Media"]} />
      <div className="space-y-8">
        <MasterPage
          title="Social Media Platform"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-social-media", "create")}
          canEdit={canDoAction("sa-social-media", "edit")}
          canDelete={canDoAction("sa-social-media", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          rowActions={(row) => (
            <button
              type="button"
              onClick={() => testConnection(row)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="Test API connection"
            >
              <PlugZap size={13} />
            </button>
          )}
          exportConfig={{
            title: "Social Media Master",
            filename: "social-media-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Platform Details",
            fields: [
              { key: "name", label: "Platform Name" },
              { key: "platformType", label: "Type" },
              { key: "apiConfigLabel", label: "API Channel" },
              { key: "adAccountId", label: "Ad Account ID" },
              { key: "pixelId", label: "Pixel / Conversion ID" },
              { key: "apiEnabled", label: "API Enabled" },
              { key: "hasAccessToken", label: "Access Token Saved" },
              { key: "hasRefreshToken", label: "Refresh Token Saved" },
              { key: "tokenExpiresAt", label: "Token Expires" },
              { key: "accountDetails", label: "Account Details" },
              { key: "notes", label: "Notes" },
              { key: "campaignCount", label: "Total Campaigns" },
              { key: "activeAdCount", label: "Active Ads" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaSocialMediaMaster;
