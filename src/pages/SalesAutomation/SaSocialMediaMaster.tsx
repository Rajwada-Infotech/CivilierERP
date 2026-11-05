import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { StatusCell, TitleCell } from "@/components/sa/saCells";
import { usePageRights } from "@/hooks/usePageRights";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { PlugZap, Megaphone, Share2, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

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
    const data: { Id: number; Label: string; Provider: string | null; HasAccessToken: number }[] = await res.json();
    return data.map((c) => ({
      value: String(c.Id),
      label: `${c.Label}${c.Provider ? ` · ${c.Provider}` : ""}${c.HasAccessToken ? "" : " (no token yet)"}`,
    }));
  } catch { return []; }
}

// Sections -> MasterPage shows the form as tabs.
const fields: FieldDef[] = [
  { name: "_platform", label: "Platform", type: "section" },
  { name: "name", label: "Platform Name", type: "text", required: true, placeholder: "e.g. Facebook – Silver Woods page" },
  {
    name: "platformType",
    label: "Type",
    type: "select",
    options: ["Facebook", "Instagram", "Google", "LinkedIn", "YouTube", "WhatsApp", "SMS", "Email Marketing", "Other"],
  },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
  { name: "accountDetails", label: "Account Details", type: "textarea", fullWidth: true, placeholder: "Page / account name, login owner, agency managing it…" },
  { name: "notes", label: "Notes", type: "textarea", fullWidth: true },

  { name: "_connection", label: "Connection", type: "section" },
  { name: "apiConfigId", label: "Connection (set up in Admin → Integrations)", type: "select", asyncOptions: fetchApiConfigOptions },
  { name: "adAccountId", label: "Ad Account ID", type: "text", placeholder: "act_1234567890" },
  { name: "pixelId", label: "Pixel / Conversion ID", type: "text" },
  { name: "apiEnabled", label: "Pull leads & results automatically", type: "toggle", defaultValue: false },
];

const columns = [
  { key: "name", label: "Platform" },
  { key: "apiEnabled", label: "Connection", hideOnMobile: true },
  { key: "campaignCount", label: "Campaigns" },
  { key: "activeAdCount", label: "Active Ads", hideOnMobile: true },
  { key: "isActive", label: "Status" },
];

const DAY = 24 * 60 * 60 * 1000;
/** Days until the token expires (negative = already expired), or null. */
const tokenDaysLeft = (row: RecordWithId): number | null =>
  row.tokenExpiresAt ? Math.ceil((new Date(String(row.tokenExpiresAt)).getTime() - Date.now()) / DAY) : null;

const ConnectionCell = (_: unknown, row: RecordWithId) => {
  if (!row.apiEnabled) return <span className="text-xs text-muted-foreground">Manual — not connected</span>;
  const days = tokenDaysLeft(row);
  const tone = !row.hasAccessToken || (days !== null && days < 0) ? "text-red-600"
    : days !== null && days <= 7 ? "text-amber-600" : "text-emerald-600";
  const text = !row.hasAccessToken ? "No token — set up its connection in Admin → Integrations"
    : days === null ? "Connected"
    : days < 0 ? "Token expired"
    : days <= 7 ? `Token expires in ${days} day${days === 1 ? "" : "s"}`
    : "Connected";
  return (
    <div className="min-w-0">
      <div className={`text-xs font-medium ${tone}`}>{text}</div>
      {row.apiConfigLabel ? <div className="text-[0.6875rem] text-muted-foreground truncate">{String(row.apiConfigLabel)}</div> : null}
      {row.usesOwnToken ? <div className="text-[0.6875rem] text-amber-600">Uses its own old token — move it to a connection in Admin → Integrations</div> : null}
    </div>
  );
};

const YesNo = (v: unknown) => <p className="text-sm">{v ? "Yes" : "No"}</p>;

const exportColumns: ExportColumn[] = [
  { header: "Platform Name", accessor: "name" },
  { header: "Type", accessor: "platformType" },
  { header: "Connection", accessor: "apiConfigLabel" },
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
      tokenExpiresAt: item.TokenExpiresAt ? String(item.TokenExpiresAt).slice(0, 10) : "",
      apiEnabled: Boolean(item.ApiEnabled),
      hasAccessToken: Boolean(item.HasAccessToken),
      usesOwnToken: Boolean(item.UsesOwnToken),
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
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Setup", "Social Media"]} title="Social Media">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load platforms. Refresh the page to try again." : "Loading platforms…"}
      </div>
    </SalesAutoShell>
  );

  const connected = mappedData.filter((p) => p.apiEnabled);
  const needsToken = connected.filter((p) => {
    const d = tokenDaysLeft(p);
    return !p.hasAccessToken || (d !== null && d <= 7);
  });
  const campaigns = mappedData.reduce((s, p) => s + Number(p.campaignCount ?? 0), 0);
  const ads = mappedData.reduce((s, p) => s + Number(p.activeAdCount ?? 0), 0);

  return (
    <SalesAutoShell
      breadcrumbs={["Sales Automation", "Setup", "Social Media"]}
      title="Social Media"
      subtitle="Where your leads come from: platforms → campaigns → ads → leads"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SalesAutoGlassCard label="Platforms" value={mappedData.length} sub={`${mappedData.filter((p) => p.isActive).length} active`} icon={Share2} accentColor="#2563eb" />
          <SalesAutoGlassCard label="Connected" value={connected.length} sub="pull leads automatically" icon={PlugZap} accentColor="#059669" />
          <SalesAutoGlassCard label="Needs a token" value={needsToken.length} sub={needsToken.length ? needsToken.map((p) => p.name).join(", ") : "all tokens current"} icon={KeyRound} accentColor={needsToken.length ? "#dc2626" : "#64748b"} />
          <SalesAutoGlassCard label="Campaigns" value={campaigns} sub={`${ads} active ads`} icon={Megaphone} accentColor="#7c3aed" />
        </div>
        <MasterPage
          title="Platform"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          canCreate={canDoAction("sa-social-media", "create")}
          canEdit={canDoAction("sa-social-media", "edit")}
          canDelete={canDoAction("sa-social-media", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          columnRenderers={{
            name: (v, row) => TitleCell(v, row.platformType),
            apiEnabled: ConnectionCell,
            isActive: (v) => StatusCell(v ? "Active" : "Inactive"),
            // Platform -> Campaign -> Ad is a real hierarchy that was never
            // discoverable in the UI — these counts now link straight into
            // the filtered next level instead of requiring a user to
            // already know the relationship exists.
            campaignCount: (value, row) => (
              <Link to={`/sales-automation/campaigns?platformId=${row._id}`} className="text-primary hover:underline">
                {String(value)} campaign{value === 1 ? "" : "s"} →
              </Link>
            ),
            activeAdCount: (value, row) => (
              <Link to={`/sales-automation/ads?platformId=${row._id}`} className="text-primary hover:underline">
                {String(value)} ad{value === 1 ? "" : "s"} →
              </Link>
            ),
          }}
          rowActions={(row) => (
            <button
              type="button"
              onClick={() => testConnection(row)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="Check the saved token and account work"
            >
              <PlugZap size={13} /> Test connection
            </button>
          )}
          exportConfig={{
            title: "Social Media",
            filename: "social-media-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Platform Details",
            fields: [
              { key: "name", label: "Platform" },
              { key: "platformType", label: "Type" },
              { key: "apiEnabled", label: "Connection", render: (v, row) => ConnectionCell(v, row) },
              { key: "apiConfigLabel", label: "Connection" },
              { key: "adAccountId", label: "Ad Account ID" },
              { key: "pixelId", label: "Pixel / Conversion ID" },
              { key: "hasAccessToken", label: "Token Available", render: YesNo },
              { key: "tokenExpiresAt", label: "Token Expires On" },
              { key: "campaignCount", label: "Campaigns" },
              { key: "activeAdCount", label: "Active Ads" },
              { key: "accountDetails", label: "Account Details" },
              { key: "notes", label: "Notes" },
              { key: "isActive", label: "Status", render: (v) => StatusCell(v ? "Active" : "Inactive") },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaSocialMediaMaster;
