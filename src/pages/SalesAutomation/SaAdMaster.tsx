import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LayoutList, BarChart2, RefreshCw, Image as ImageIcon, Upload, Download, Trash2, Wallet, Receipt, Users, CheckCircle2, IndianRupee, TrendingUp } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaTabs } from "@/components/sa/SaTabs";

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

// Grouped into sections so MasterPage shows the form as tabs (one concern
// per tab) instead of one long scroll.
const fields: FieldDef[] = [
  { name: "_basics", label: "Basics", type: "section" },
  {
    name: "campaignId",
    label: "Campaign",
    type: "select",
    required: true,
    asyncOptions: fetchCampaignOptions,
  },
  { name: "name", label: "Ad Name", type: "text", required: true, placeholder: "e.g. Diwali 3BHK – Carousel" },
  {
    name: "adType",
    label: "Ad Type",
    type: "select",
    options: ["Image", "Video", "Carousel", "Story", "Reel", "Search", "Display", "Other"],
  },
  { name: "objective", label: "Objective", type: "select", options: ["Lead Generation", "Traffic", "Reach", "Awareness", "Engagement", "Conversions", "Sales"] },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Paused", "Completed", "Cancelled"],
    defaultValue: "Active",
  },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },

  { name: "_creative", label: "Creative", type: "section" },
  { name: "headline", label: "Headline", type: "text", placeholder: "The first line people read" },
  { name: "ctaText", label: "Call to Action", type: "text", placeholder: "Book a Site Visit, Call Now…" },
  { name: "creativeRef", label: "Creative Reference", type: "text", placeholder: "Agency file name or code" },
  { name: "description", label: "Ad Copy", type: "textarea", fullWidth: true, placeholder: "The body text shown with the ad" },
  { name: "keypoints", label: "Talking Points", type: "textarea", fullWidth: true, placeholder: "One per line — key selling points this ad should hit" },
  { name: "imageUrl", label: "Image URL", type: "text", placeholder: "https://…" },
  { name: "videoUrl", label: "Video URL", type: "text", placeholder: "https://…" },
  { name: "mediaUrls", label: "More Media URLs", type: "textarea", fullWidth: true, placeholder: "One URL per line or comma-separated. Upload files with the row's Creatives button." },

  { name: "_audience", label: "Audience", type: "section" },
  { name: "targetAgeMin", label: "Age From", type: "number", placeholder: "18" },
  { name: "targetAgeMax", label: "Age To", type: "number", placeholder: "65" },
  { name: "targetGender", label: "Gender", type: "select", options: ["All", "Male", "Female", "Other"] },
  { name: "targetLanguages", label: "Languages", type: "text", placeholder: "Bengali, Hindi, English" },
  { name: "targetRadiusKm", label: "Radius (km)", type: "number", placeholder: "Around each location" },
  { name: "targetLocations", label: "Locations", type: "textarea", fullWidth: true, placeholder: "Cities, areas or pin codes — one per line" },
  { name: "targetInterests", label: "Interests", type: "textarea", fullWidth: true, placeholder: "Real estate, home loans, interior design…" },
  { name: "targetBehaviors", label: "Behaviours", type: "textarea", fullWidth: true, placeholder: "Likely to move, first-time buyers, NRIs…" },

  { name: "_delivery", label: "Delivery", type: "section" },
  { name: "platformPlacement", label: "Placement", type: "text", placeholder: "Feed, Reels, Search, Display…" },
  { name: "scheduledStartAt", label: "Starts On", type: "date" },
  { name: "scheduledEndAt", label: "Ends On", type: "date" },
  { name: "runningSince", label: "Running Since", type: "date" },
  { name: "optimizationGoal", label: "Optimisation Goal", type: "text", placeholder: "Leads, link clicks…" },
  { name: "bidStrategy", label: "Bid Strategy", type: "text", placeholder: "Lowest cost, cost cap…" },
  { name: "destinationUrl", label: "Landing Page URL", type: "text", fullWidth: true, placeholder: "https://…" },
  { name: "utmParameters", label: "UTM Parameters", type: "textarea", fullWidth: true, placeholder: "{\"utm_source\":\"facebook\",\"utm_medium\":\"paid\"}" },

  { name: "_budget", label: "Budget", type: "section" },
  { name: "budget", label: "Total Budget", type: "number", prefix: "₹" },
  { name: "dailySpend", label: "Daily Spend", type: "number", prefix: "₹" },
  { name: "spent", label: "Manual Spend", type: "number", prefix: "₹", placeholder: "Used only when no invoices are linked" },

  { name: "_sync", label: "Platform Sync", type: "section" },
  { name: "externalAdId", label: "Platform Ad ID", type: "text", placeholder: "ID on Meta / Google" },
  { name: "externalAdSetId", label: "Platform Ad Set ID", type: "text" },
  { name: "syncStatus", label: "Sync Status", type: "select", options: ["Pending", "Synced", "Failed"] },
];

const columns = [
  { key: "adCode", label: "Code" },
  { key: "name", label: "Ad" },
  { key: "campaignName", label: "Campaign", hideOnMobile: true },
  { key: "adType", label: "Type", hideOnMobile: true },
  { key: "budget", label: "Budget", hideOnMobile: true },
  { key: "costSpent", label: "Spent", hideOnMobile: true },
  { key: "totalLeadsGenerated", label: "Leads" },
  { key: "costPerLead", label: "Cost / Lead", hideOnMobile: true },
  { key: "roi", label: "ROI", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const fmtRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const money = (v: unknown) => (Number(v) > 0 ? fmtRs(Number(v)) : "—");
const roiText = (v: unknown) => {
  const n = Number(v ?? 0);
  return <span className={`font-semibold tabular-nums ${n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-muted-foreground"}`}>{n ? fmtPct(n) : "—"}</span>;
};
const viewMoney = (v: unknown) => <p className="text-sm tabular-nums">{money(v)}</p>;

const columnRenderers: Record<string, (v: unknown, row: RecordWithId) => React.ReactNode> = {
  adCode: (v) => <span className="font-mono text-xs text-muted-foreground">{String(v || "—")}</span>,
  name: (v, row) => (
    <div className="min-w-0">
      <div className="font-medium text-foreground truncate">{String(v)}</div>
      {row.headline ? <div className="text-xs text-muted-foreground truncate max-w-[16rem]">{String(row.headline)}</div> : null}
    </div>
  ),
  budget: (v) => <span className="tabular-nums">{money(v)}</span>,
  costSpent: (v) => <span className="tabular-nums">{money(v)}</span>,
  costPerLead: (v) => <span className="tabular-nums">{money(v)}</span>,
  totalLeadsGenerated: (v) => <span className="font-semibold tabular-nums">{Number(v ?? 0)}</span>,
  roi: roiText,
  status: (v, row) => (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge status={String(v || "Active")} />
      {row.isActive === false && <span className="text-[0.6875rem] text-muted-foreground">Inactive</span>}
    </span>
  ),
};

const exportColumns: ExportColumn[] = [
  { header: "Ad Name", accessor: "name" },
  { header: "Campaign", accessor: "campaignName" },
  { header: "Ad Type", accessor: "adType" },
  { header: "Creative Ref", accessor: "creativeRef" },
  { header: "Headline", accessor: "headline" },
  { header: "CTA", accessor: "ctaText" },
  { header: "Placement", accessor: "platformPlacement" },
  { header: "Objective", accessor: "objective" },
  { header: "Target Locations", accessor: "targetLocations" },
  { header: "Radius Km", accessor: "targetRadiusKm" },
  { header: "External Ad ID", accessor: "externalAdId" },
  { header: "Sync Status", accessor: "syncStatus" },
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

async function fetchCreatives(adId: string): Promise<any[]> {
  const res = await fetchWithAuth(`${API}/${adId}/creatives`);
  return res.ok ? res.json() : [];
}

// Upload/list/delete image & video creatives for one ad — a standalone
// dialog (not part of MasterPage's generic edit form, which has no file-
// upload extension point) triggered per-row.
const CreativesDialog: React.FC<{ adId: string; adName: string; onClose: () => void }> = ({ adId, adName, onClose }) => {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const { data: creatives = [], isLoading } = useQuery({
    queryKey: ["sa-ad-creatives", adId],
    queryFn: () => fetchCreatives(adId),
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetchWithAuth(`${API}/${adId}/creatives`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      toast.success("Creative(s) uploaded");
      qc.invalidateQueries({ queryKey: ["sa-ad-creatives", adId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (creativeId: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${adId}/creatives/${creativeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      toast.success("Creative removed");
      qc.invalidateQueries({ queryKey: ["sa-ad-creatives", adId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><ImageIcon size={16} className="text-primary" /> Creatives — {adName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-6 cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors">
            <Upload size={16} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Click to upload image or video creatives (up to 100MB each)"}</span>
            <input type="file" multiple accept="image/*,video/*" className="hidden" disabled={uploading}
              onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
          </label>

          {isLoading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Loading...</div>
          ) : creatives.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">No creatives uploaded yet</div>
          ) : (
            <div className="space-y-2">
              {(creatives as any[]).map((c) => (
                <div key={c.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">{c.MediaType}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.FileName}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">{c.FileSize ? `${(c.FileSize / 1024).toFixed(0)} KB` : ""} · {c.UploadedByName || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={`${API}/${adId}/creatives/file/${c.Id}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-muted text-muted-foreground"><Download size={13} /> Open</a>
                    <button onClick={() => handleDelete(c.Id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-rose-50 text-muted-foreground hover:text-rose-600">
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SaAdMaster: React.FC = () => {
  usePageRights("sa-ads");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"list" | "performance">("list");
  const [creativesFor, setCreativesFor] = useState<{ id: string; name: string } | null>(null);
  // Pre-filter when arriving from Campaign Master's "N ads" link.
  const [searchParams] = useSearchParams();
  const campaignFilter = searchParams.get("campaignId");
  // ...or from Social Media Master's "N active ads" link.
  const platformFilter = searchParams.get("platformId");

  const { data: ads, isLoading, error } = useQuery({
    queryKey: ["sa-ads"],
    queryFn: fetchAds,
    staleTime: 5 * 60 * 1000,
  });

  const allMappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(ads)) return [];
    return ads.map((item) => ({
      _id: String(item.Id),
      adCode: item.AdCode ?? "",
      campaignId: String(item.CampaignId ?? ""),
      campaignName: item.CampaignName ?? "",
      platformId: String(item.PlatformId ?? ""),
      name: item.Name ?? "",
      adType: item.AdType ?? "",
      creativeRef: item.CreativeRef ?? "",
      headline: item.Headline ?? "",
      description: item.Description ?? "",
      ctaText: item.CtaText ?? "",
      imageUrl: item.ImageUrl ?? "",
      videoUrl: item.VideoUrl ?? "",
      mediaUrls: item.MediaUrls ?? "",
      keypoints: item.Keypoints ?? "",
      targetAgeMin: item.TargetAgeMin ?? "",
      targetAgeMax: item.TargetAgeMax ?? "",
      targetGender: item.TargetGender ?? "",
      targetLocations: item.TargetLocations ?? "",
      targetRadiusKm: item.TargetRadiusKm ?? "",
      targetInterests: item.TargetInterests ?? "",
      targetBehaviors: item.TargetBehaviors ?? "",
      targetLanguages: item.TargetLanguages ?? "",
      scheduledStartAt: item.ScheduledStartAt ? String(item.ScheduledStartAt).slice(0, 10) : "",
      scheduledEndAt: item.ScheduledEndAt ? String(item.ScheduledEndAt).slice(0, 10) : "",
      platformPlacement: item.PlatformPlacement ?? "",
      objective: item.Objective ?? "",
      optimizationGoal: item.OptimizationGoal ?? "",
      bidStrategy: item.BidStrategy ?? "",
      destinationUrl: item.DestinationUrl ?? "",
      utmParameters: item.UtmParameters ?? "",
      externalAdId: item.ExternalAdId ?? "",
      externalAdSetId: item.ExternalAdSetId ?? "",
      syncStatus: item.SyncStatus ?? "",
      lastSyncedAt: item.LastSyncedAt ? String(item.LastSyncedAt).slice(0, 10) : "",
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

  const mappedData = React.useMemo(
    () => allMappedData.filter((a) =>
      (!campaignFilter || a.campaignId === campaignFilter) &&
      (!platformFilter || a.platformId === platformFilter)),
    [allMappedData, campaignFilter, platformFilter],
  );

  const toPayload = (r: Record<string, any>) => ({
    CampaignId: r.campaignId ? parseInt(r.campaignId) : null,
    Name: r.name?.trim() || null,
    AdType: r.adType || null,
    CreativeRef: r.creativeRef || null,
    Headline: r.headline || null,
    Description: r.description || null,
    CtaText: r.ctaText || null,
    ImageUrl: r.imageUrl || null,
    VideoUrl: r.videoUrl || null,
    MediaUrls: r.mediaUrls || null,
    Keypoints: r.keypoints || null,
    TargetAgeMin: r.targetAgeMin ? parseInt(r.targetAgeMin) : null,
    TargetAgeMax: r.targetAgeMax ? parseInt(r.targetAgeMax) : null,
    TargetGender: r.targetGender || null,
    TargetLocations: r.targetLocations || null,
    TargetRadiusKm: r.targetRadiusKm ? parseFloat(r.targetRadiusKm) : null,
    TargetInterests: r.targetInterests || null,
    TargetBehaviors: r.targetBehaviors || null,
    TargetLanguages: r.targetLanguages || null,
    ScheduledStartAt: r.scheduledStartAt || null,
    ScheduledEndAt: r.scheduledEndAt || null,
    PlatformPlacement: r.platformPlacement || null,
    Objective: r.objective || null,
    OptimizationGoal: r.optimizationGoal || null,
    BidStrategy: r.bidStrategy || null,
    DestinationUrl: r.destinationUrl || null,
    UtmParameters: r.utmParameters || null,
    Budget: r.budget ? parseFloat(r.budget) : 0,
    DailySpend: r.dailySpend ? parseFloat(r.dailySpend) : 0,
    Spent: r.spent ? parseFloat(r.spent) : 0,
    RunningSince: r.runningSince || null,
    Status: r.status || "Active",
    ExternalAdId: r.externalAdId || null,
    ExternalAdSetId: r.externalAdSetId || null,
    SyncStatus: r.syncStatus || null,
    IsActive: r.isActive !== false,
  });

  const syncAd = async (row: RecordWithId) => {
    try {
      const res = await fetchWithAuth(`${API}/${row._id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Mode: "Preview" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to sync ad");
      toast.success(data.message || "Ad sync payload prepared");
      await queryClient.invalidateQueries({ queryKey: ["sa-ads"] });
    } catch (err: any) {
      toast.error(err.message || "Ad sync failed");
    }
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
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
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Ads"]} title="Ads">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load ads. Refresh the page to try again." : "Loading ads…"}
      </div>
    </SalesAutoShell>
  );

  const totalBudget = mappedData.reduce((s, a) => s + Number(a.budget ?? 0), 0);
  const totalSpent = mappedData.reduce((s, a) => s + Number(a.costSpent ?? 0), 0);
  const totalLeads = mappedData.reduce((s, a) => s + Number(a.totalLeadsGenerated ?? 0), 0);
  const totalBookings = mappedData.reduce((s, a) => s + Number(a.bookingCount ?? 0), 0);
  const totalRevenue = mappedData.reduce((s, a) => s + Number(a.revenueGenerated ?? 0), 0);
  const avgROI = mappedData.filter((a) => Number(a.roi) !== 0).length
    ? mappedData.reduce((s, a) => s + Number(a.roi ?? 0), 0) / mappedData.filter((a) => Number(a.roi) !== 0).length
    : 0;

  return (
    <SalesAutoShell
      breadcrumbs={["Sales Automation", "Ads"]}
      title="Ads"
      subtitle={campaignFilter ? `Ads in ${mappedData[0]?.campaignName || "the selected campaign"}`
        : platformFilter ? "Ads on the selected platform"
        : `${mappedData.length} ad${mappedData.length === 1 ? "" : "s"} across your campaigns — creative, audience, budget and results`}
    >
      <div className="space-y-6">
        {(campaignFilter || platformFilter) && (
          <Link to="/sales-automation/ads" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            ← Clear {campaignFilter ? "campaign" : "platform"} filter, show all ads
          </Link>
        )}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <SaTabs
            tabs={[
              { key: "list", icon: LayoutList, label: "List" },
              { key: "performance", icon: BarChart2, label: "Performance" },
            ]}
            active={activeTab}
            onChange={(key) => setActiveTab(key)}
          />
        </div>

        {/* PERFORMANCE TAB */}
        {activeTab === "performance" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <SalesAutoGlassCard label="Budget" value={fmtRs(totalBudget)} icon={Wallet} accentColor="#2563eb" />
              <SalesAutoGlassCard label="Spent" value={fmtRs(totalSpent)} sub={totalBudget ? `${fmtPct((totalSpent / totalBudget) * 100)} of budget` : undefined} icon={Receipt} accentColor="#ea580c" />
              <SalesAutoGlassCard label="Leads" value={totalLeads} sub={totalLeads ? `${fmtRs(totalSpent / totalLeads)} per lead` : undefined} icon={Users} accentColor="#7c3aed" />
              <SalesAutoGlassCard label="Bookings" value={totalBookings} icon={CheckCircle2} accentColor="#059669" />
              <SalesAutoGlassCard label="Revenue" value={fmtRs(totalRevenue)} icon={IndianRupee} accentColor="#16a34a" />
              <SalesAutoGlassCard label="Average ROI" value={fmtPct(avgROI)} icon={TrendingUp} accentColor={avgROI >= 0 ? "#059669" : "#dc2626"} />
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
                      {["Ad", "Campaign", "Budget", "Spent", "Leads", "Cost / Lead", "Conversion", "Bookings", "Revenue", "ROI"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedData.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">No ads yet. Add one from the List tab to start tracking results.</td></tr>
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
                  {mappedData.length > 1 && (
                    <tfoot className="border-t-2 border-border bg-muted/20 font-semibold text-xs">
                      <tr>
                        <td className="px-3 py-2.5" colSpan={2}>Total</td>
                        <td className="px-3 py-2.5 tabular-nums">{fmtRs(totalBudget)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-orange-600">{fmtRs(totalSpent)}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{totalLeads}</td>
                        <td className="px-3 py-2.5 tabular-nums">{totalLeads ? fmtRs(totalSpent / totalLeads) : "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums">{totalLeads ? fmtPct((totalBookings / totalLeads) * 100) : "—"}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums text-emerald-600">{totalBookings}</td>
                        <td className="px-3 py-2.5 tabular-nums text-green-600">{fmtRs(totalRevenue)}</td>
                        <td className="px-3 py-2.5">{roiText(avgROI)}</td>
                      </tr>
                    </tfoot>
                  )}
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
          columnRenderers={columnRenderers}
          collapsibleAddForm
          gridCols={3}
          canCreate={canDoAction("sa-ads", "create")}
          canEdit={canDoAction("sa-ads", "edit")}
          canDelete={canDoAction("sa-ads", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          rowActions={(row) => (
            <>
              <button
                type="button"
                onClick={() => setCreativesFor({ id: String(row._id), name: String(row.name) })}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Manage creatives (image/video upload)"
              >
                <ImageIcon size={13} /> Creatives
              </button>
              <button
                type="button"
                onClick={() => syncAd(row)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Prepare external ad sync"
              >
                <RefreshCw size={13} /> Sync
              </button>
            </>
          )}
          exportConfig={{
            title: "Ads",
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
              { key: "headline", label: "Headline" },
              { key: "description", label: "Description" },
              { key: "ctaText", label: "CTA Text" },
              { key: "imageUrl", label: "Image URL" },
              { key: "videoUrl", label: "Video URL" },
              { key: "mediaUrls", label: "Media URLs" },
              { key: "keypoints", label: "Keypoints / Ad Copy Talking Points" },
              { key: "targetAgeMin", label: "Target Age Min" },
              { key: "targetAgeMax", label: "Target Age Max" },
              { key: "targetGender", label: "Target Gender" },
              { key: "targetLocations", label: "Target Locations" },
              { key: "targetRadiusKm", label: "Target Radius Km" },
              { key: "targetInterests", label: "Target Interests" },
              { key: "targetBehaviors", label: "Target Behaviors" },
              { key: "targetLanguages", label: "Target Languages" },
              { key: "platformPlacement", label: "Placement" },
              { key: "objective", label: "Objective" },
              { key: "optimizationGoal", label: "Optimization Goal" },
              { key: "bidStrategy", label: "Bid Strategy" },
              { key: "destinationUrl", label: "Destination URL" },
              { key: "utmParameters", label: "UTM Parameters" },
              { key: "externalAdId", label: "External Ad ID" },
              { key: "externalAdSetId", label: "External Ad Set ID" },
              { key: "syncStatus", label: "Sync Status" },
              { key: "lastSyncedAt", label: "Last Synced" },
              { key: "budget", label: "Total Budget", render: viewMoney },
              { key: "dailySpend", label: "Daily Spend", render: viewMoney },
              { key: "spent", label: "Manual Spend", render: viewMoney },
              { key: "costSpent", label: "Spent", render: viewMoney },
              { key: "invoiceCount", label: "Linked Invoices" },
              { key: "totalLeadsGenerated", label: "Leads" },
              { key: "costPerLead", label: "Cost / Lead", render: viewMoney },
              { key: "conversionRate", label: "Conversion", render: (v) => <p className="text-sm tabular-nums">{fmtPct(Number(v ?? 0))}</p> },
              { key: "bookingCount", label: "Bookings" },
              { key: "revenueGenerated", label: "Revenue", render: viewMoney },
              { key: "roi", label: "ROI", render: (v) => roiText(v) },
              { key: "runningSince", label: "Running Since" },
              { key: "status", label: "Status", render: (v) => <StatusBadge status={String(v || "Active")} /> },
              { key: "isActive", label: "Active" },
            ],
          }}
        />}
      </div>

      {creativesFor && (
        <CreativesDialog adId={creativesFor.id} adName={creativesFor.name} onClose={() => setCreativesFor(null)} />
      )}
    </SalesAutoShell>
  );
};

export default SaAdMaster;
