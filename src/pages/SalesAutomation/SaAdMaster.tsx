import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LayoutList, BarChart2, RefreshCw, Image as ImageIcon, Upload, Download, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  { name: "headline", label: "Headline", type: "text" },
  { name: "description", label: "Ad Copy / Description", type: "textarea", fullWidth: true },
  { name: "ctaText", label: "CTA Text", type: "text" },
  { name: "imageUrl", label: "Image URL", type: "text" },
  { name: "videoUrl", label: "Video URL", type: "text" },
  { name: "mediaUrls", label: "Media URLs", type: "textarea", fullWidth: true, placeholder: "Comma-separated or JSON array" },
  { name: "keypoints", label: "Keypoints / Ad Copy Talking Points", type: "textarea", fullWidth: true, placeholder: "One per line — key selling points this ad should hit" },
  { name: "targetAgeMin", label: "Age Min", type: "number" },
  { name: "targetAgeMax", label: "Age Max", type: "number" },
  { name: "targetGender", label: "Gender", type: "select", options: ["All", "Male", "Female", "Other"] },
  { name: "targetLocations", label: "Target Locations", type: "textarea", fullWidth: true, placeholder: "Locations, pin codes, or JSON" },
  { name: "targetRadiusKm", label: "Radius (Km)", type: "number" },
  { name: "targetInterests", label: "Target Interests", type: "textarea", fullWidth: true },
  { name: "targetBehaviors", label: "Target Behaviors", type: "textarea", fullWidth: true },
  { name: "targetLanguages", label: "Target Languages", type: "text" },
  { name: "scheduledStartAt", label: "Scheduled Start", type: "date" },
  { name: "scheduledEndAt", label: "Scheduled End", type: "date" },
  { name: "platformPlacement", label: "Placement", type: "text", placeholder: "Feed, Reels, Search, Display..." },
  { name: "objective", label: "Objective", type: "select", options: ["Lead Generation", "Traffic", "Reach", "Awareness", "Engagement", "Conversions", "Sales"] },
  { name: "optimizationGoal", label: "Optimization Goal", type: "text" },
  { name: "bidStrategy", label: "Bid Strategy", type: "text" },
  { name: "destinationUrl", label: "Destination URL", type: "text" },
  { name: "utmParameters", label: "UTM Parameters", type: "textarea", fullWidth: true, placeholder: "{\"utm_source\":\"google\",\"utm_medium\":\"cpc\"}" },
  { name: "budget", label: "Budget (Rs)", type: "number" },
  { name: "dailySpend", label: "Daily Spend (Rs)", type: "number" },
  { name: "spent", label: "Fallback Spend (Rs)", type: "number" },
  { name: "externalAdId", label: "External Ad ID", type: "text" },
  { name: "externalAdSetId", label: "External Ad Set ID", type: "text" },
  { name: "syncStatus", label: "Sync Status", type: "select", options: ["Pending", "Synced", "Failed"] },
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
  { key: "adCode", label: "Ad Code" },
  { key: "name", label: "Ad Name" },
  { key: "campaignName", label: "Campaign" },
  { key: "adType", label: "Type", hideOnMobile: true },
  { key: "platformPlacement", label: "Placement", hideOnMobile: true },
  { key: "targetRadiusKm", label: "Radius Km", hideOnMobile: true },
  { key: "budget", label: "Budget (Rs)", hideOnMobile: true },
  { key: "costSpent", label: "Cost Spent (Rs)", hideOnMobile: true },
  { key: "totalLeadsGenerated", label: "Leads", hideOnMobile: true },
  { key: "costPerLead", label: "CPL (Rs)", hideOnMobile: true },
  { key: "conversionRate", label: "Conv. %", hideOnMobile: true },
  { key: "roi", label: "ROI %", hideOnMobile: true },
  { key: "syncStatus", label: "Sync", hideOnMobile: true },
  { key: "status", label: "Status" },
  { key: "isActive", label: "Active" },
];

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
      toast.error(e.message);
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
      toast.error(e.message);
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
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">{c.MediaType}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.FileName}</div>
                      <div className="text-[11px] text-muted-foreground">{c.FileSize ? `${(c.FileSize / 1024).toFixed(0)} KB` : ""} · {c.UploadedByName || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={`${API}/${adId}/creatives/file/${c.Id}`} target="_blank" rel="noreferrer"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><Download size={14} /></a>
                    <button onClick={() => handleDelete(c.Id)} className="p-1.5 rounded-md hover:bg-rose-50 text-muted-foreground hover:text-rose-600">
                      <Trash2 size={14} />
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
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"list" | "performance">("list");
  const [creativesFor, setCreativesFor] = useState<{ id: string; name: string } | null>(null);

  const { data: ads, isLoading, error } = useQuery({
    queryKey: ["sa-ads"],
    queryFn: fetchAds,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(ads)) return [];
    return ads.map((item) => ({
      _id: String(item.Id),
      adCode: item.AdCode ?? "",
      campaignId: String(item.CampaignId ?? ""),
      campaignName: item.CampaignName ?? "",
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
    <SalesAutoShell title="Ad Master" subtitle="Manage advertisements running under each campaign">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
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
          rowActions={(row) => (
            <>
              <button
                type="button"
                onClick={() => setCreativesFor({ id: String(row._id), name: String(row.name) })}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Manage creatives (image/video upload)"
              >
                <ImageIcon size={13} />
              </button>
              <button
                type="button"
                onClick={() => syncAd(row)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Prepare external ad sync"
              >
                <RefreshCw size={13} />
              </button>
            </>
          )}
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

      {creativesFor && (
        <CreativesDialog adId={creativesFor.id} adName={creativesFor.name} onClose={() => setCreativesFor(null)} />
      )}
    </SalesAutoShell>
  );
};

export default SaAdMaster;
