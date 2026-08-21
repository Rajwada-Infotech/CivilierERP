import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Megaphone,
  TrendingUp,
  DollarSign,
  Eye,
  MousePointer,
  Plus,
  Play,
  Pause,
  BarChart3,
  Star,
  CheckCircle2,
  Upload,
  FileImage,
  Trash2,
  PhoneCall,
  Info,
  X,
  Image,
  Video,
} from "lucide-react";
import { toast } from "sonner";

type AdStatus = "active" | "paused" | "pending" | "completed";

interface Creative {
  id: string;
  name: string;
  type: "banner" | "video";
  size: string;
  uploadedOn: string;
  status: "approved" | "pending" | "rejected";
}

interface Ad {
  id: string;
  tenantId: string;
  tenantName: string;
  title: string;
  description: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  status: AdStatus;
  startDate: string;
  endDate: string;
  category: string;
  creatives: Creative[];
}

const STATUS_CONFIG = {
  active: {
    color: "bg-green-500/15 text-green-600 border-green-500/30",
    label: "Active",
  },
  paused: {
    color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
    label: "Paused",
  },
  pending: {
    color: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    label: "Pending",
  },
  completed: {
    color: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    label: "Completed",
  },
};

const CREATIVE_STATUS_CONFIG = {
  approved: {
    color: "bg-green-500/15 text-green-600 border-green-500/30",
    label: "Approved",
  },
  pending: {
    color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
    label: "Pending Review",
  },
  rejected: {
    color: "bg-red-500/15 text-red-600 border-red-500/30",
    label: "Rejected",
  },
};

export default function AdsManager() {
  usePageRights("dba-ads");
  const queryClient = useQueryClient();

  const { data: serverAds = [] } = useQuery<Ad[]>({
    queryKey: ["dba-ads"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/ads");
      if (!res.ok) throw new Error("Failed to load ads");
      const rows = await res.json().catch(() => ({}));
      // Normalize DB snake_case to component shape
      return rows.map((r: any) => ({
        id: String(r.Id),
        tenantId: r.tenant_id ?? "",
        tenantName: r.tenant_name ?? "",
        title: r.title,
        description: r.description ?? "",
        budget: Number(r.budget) || 0,
        spent: Number(r.spent) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        status: r.status as AdStatus,
        startDate: r.start_date ? r.start_date.split("T")[0] : "",
        endDate: r.end_date ? r.end_date.split("T")[0] : "",
        category: r.category ?? "",
        creatives: [],
      }));
    },
  });

  // Local creative overrides — creatives are managed client-side until a
  // backend endpoint exists. Keyed by ad id, merged over the server data.
  const [localCreatives, setLocalCreatives] = useState<
    Record<string, Creative[]>
  >({});

  const ads: Ad[] = serverAds.map((a) => ({
    ...a,
    creatives: localCreatives[a.id] ?? a.creatives,
  }));

  const setAds = (
    updater: ((prev: Ad[]) => Ad[]) | Ad[],
  ) => {
    const next = typeof updater === "function" ? updater(ads) : updater;
    const patch: Record<string, Creative[]> = {};
    next.forEach((a) => {
      patch[a.id] = a.creatives;
    });
    setLocalCreatives(patch);
  };

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetchWithAuth(`/api/dba/ads/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dba-ads"] }),
  });

  const createAdMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetchWithAuth("/api/dba/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create ad");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dba-ads"] }),
  });

  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creativesOpen, setCreativesOpen] = useState(false);
  const [creativesTarget, setCreativesTarget] = useState<Ad | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState<"campaigns" | "creatives">(
    "campaigns",
  );
  const [globalCreativesTarget, setGlobalCreativesTarget] =
    useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const globalFileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    tenantId: "T-001",
    tenantName: "Civilier Constructions Pvt Ltd",
    title: "",
    description: "",
    budget: "",
    category: "Brand Awareness",
    startDate: "",
    endDate: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    creativeType: "Banner",
  });

  const totalRevenue = ads.reduce((s, a) => s + Math.round(a.spent * 0.4), 0);
  const totalSpend = ads.reduce((s, a) => s + a.spent, 0);
  const totalImpressions = ads.reduce((s, a) => s + a.impressions, 0);
  const activeAds = ads.filter((a) => a.status === "active").length;

  const allCreatives = ads.flatMap((a) =>
    a.creatives.map((c) => ({
      ...c,
      tenantName: a.tenantName,
      adTitle: a.title,
      adId: a.id,
    })),
  );

  const handleToggle = (ad: Ad) => {
    const newStatus = ad.status === "active" ? "paused" : "active";
    toggleStatusMutation.mutate(
      { id: ad.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            ad.status === "active"
              ? `"${ad.title}" paused`
              : `"${ad.title}" resumed`,
          ),
        onError: () => toast.error("Failed to update status"),
      },
    );
  };

  const handleCreate = () => {
    if (
      !form.title ||
      !form.budget ||
      !form.startDate ||
      !form.endDate ||
      !form.contactEmail
    ) {
      toast.error("Please fill all required fields");
      return;
    }

    createAdMutation.mutate(
      {
        tenant_id: form.tenantId,
        title: form.title,
        description: form.description,
        budget: parseInt(form.budget),
        start_date: form.startDate,
        end_date: form.endDate,
        category: form.category,
        contact_email: form.contactEmail || null,
        creative_type: form.creativeType || null,
      },
      {
        onSuccess: () =>
          toast.success("Campaign created! Tenant will be contacted."),
        onError: () => toast.error("Failed to create campaign"),
      },
    );
    setCreateOpen(false);

    setForm({
      tenantId: "T-001",
      tenantName: "Civilier Constructions Pvt Ltd",
      title: "",
      description: "",
      budget: "",
      category: "Brand Awareness",
      startDate: "",
      endDate: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      creativeType: "Banner",
    });
  };

  const doUpload = (files: File[], targetAdId: string) => {
    const newCreatives: Creative[] = files.map((f, i) => ({
      id: `CR-NEW-${Date.now()}-${i}`,
      name: f.name,
      type: f.type.startsWith("video") ? "video" : "banner",
      size:
        f.size > 1024 * 1024
          ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(f.size / 1024)} KB`,
      uploadedOn: new Date().toISOString().split("T")[0],
      status: "pending",
    }));

    setAds((prev) =>
      prev.map((a) =>
        a.id === targetAdId
          ? { ...a, creatives: [...a.creatives, ...newCreatives] }
          : a,
      ),
    );

    setUploadingFiles([]);
    setCreativesOpen(false);
    toast.success(`${newCreatives.length} creative(s) uploaded for review`);
  };

  const handleUploadFromDialog = () => {
    if (!creativesTarget || uploadingFiles.length === 0) {
      toast.error("Please select files");
      return;
    }
    doUpload(uploadingFiles, creativesTarget.id);
  };

  const handleGlobalUpload = (files: File[]) => {
    if (!globalCreativesTarget) {
      toast.error("Select a campaign first");
      return;
    }
    doUpload(files, globalCreativesTarget);
  };

  const handleDeleteCreative = (adId: string, creativeId: string) => {
    setAds((prev) =>
      prev.map((a) =>
        a.id === adId
          ? { ...a, creatives: a.creatives.filter((c) => c.id !== creativeId) }
          : a,
      ),
    );
    toast.success("Creative removed");
  };

  const approveCreative = (
    creativeId: string,
    status: "approved" | "rejected",
  ) => {
    setAds((prev) =>
      prev.map((a) => ({
        ...a,
        creatives: a.creatives.map((c) =>
          c.id === creativeId ? { ...c, status } : c,
        ),
      })),
    );
    toast.success(
      status === "approved" ? "Creative approved" : "Creative rejected",
    );
  };

  const ctr = (ad: Ad) =>
    ad.impressions > 0
      ? ((ad.clicks / ad.impressions) * 100).toFixed(2)
      : "0.00";

  return (
    <div className="max-w-[1400px] mx-auto">
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "Ads" }]} />

      <DbaShell
        title="Ads Manager"
        subtitle="All campaigns managed exclusively by DBA — tenants contact us to get started"
        icon={Megaphone}
        action={
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-700"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={13} /> New Campaign
          </Button>
        }
      >
      <div className="flex items-start gap-3 bg-violet-500/8 border border-violet-500/20 rounded-lg p-3">
        <Info size={15} className="text-violet-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground">
          <strong className="text-violet-700">DBA-Only Advertising.</strong>
          Tenants contact our team to initiate a campaign. We handle all
          planning, execution & reporting and retain <strong>40%</strong> of ad
          spend as our service fee. Tenants upload their banners/videos which go
          through our approval process before going live.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Active Campaigns",
            value: activeAds,
            icon: Play,
            color: "text-green-500",
          },
          {
            label: "Total Impressions",
            value:
              totalImpressions >= 1000
                ? `${(totalImpressions / 1000).toFixed(0)}K`
                : totalImpressions,
            icon: Eye,
            color: "text-blue-500",
          },
          {
            label: "Total Ad Spend",
            value: `₹${(totalSpend / 1000).toFixed(0)}K`,
            icon: TrendingUp,
            color: "text-orange-500",
          },
          {
            label: "Platform Revenue (40%)",
            value: `₹${(totalRevenue / 1000).toFixed(1)}K`,
            icon: DollarSign,
            color: "text-violet-500",
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <s.icon size={18} className={s.color} />
              <div>
                <div className="text-lg font-bold leading-none">{s.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {s.label}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 border-b">
        {[
          { key: "campaigns", label: "Campaigns" },
          { key: "creatives", label: `Creatives (${allCreatives.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`text-xs pb-2 px-1 border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-violet-500 text-violet-600 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "campaigns" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 size={14} className="text-violet-500" />
              Campaign Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Campaign</TableHead>
                    <TableHead>Budget / Spent</TableHead>
                    <TableHead>Impressions</TableHead>
                    <TableHead>Clicks / CTR</TableHead>
                    <TableHead>Platform (40%)</TableHead>
                    <TableHead>Creatives</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ads.map((ad) => {
                    const SC = STATUS_CONFIG[ad.status];
                    const spentPct = Math.round((ad.spent / ad.budget) * 100);
                    const approved = ad.creatives.filter(
                      (c) => c.status === "approved",
                    ).length;

                    return (
                      <TableRow key={ad.id} className="text-xs">
                        <TableCell>
                          <div className="font-medium text-[11px] max-w-[160px] truncate">
                            {ad.title}
                          </div>
                          <div className="text-muted-foreground text-[10px]">
                            {ad.tenantName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px]">
                            ₹{ad.spent.toLocaleString()} / ₹
                            {ad.budget.toLocaleString()}
                          </div>
                          <div className="w-20 h-1 bg-muted rounded-full mt-1">
                            <div
                              className={`h-1 rounded-full ${spentPct >= 90 ? "bg-red-500" : spentPct >= 70 ? "bg-yellow-500" : "bg-violet-500"}`}
                              style={{ width: `${Math.min(spentPct, 100)}%` }}
                            />
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {spentPct}% used
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono">
                            {ad.impressions.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>{ad.clicks.toLocaleString()}</div>
                          <div className="text-muted-foreground text-[10px]">
                            CTR: {ctr(ad)}%
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-bold text-violet-600">
                            ₹{Math.round(ad.spent * 0.4).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <button
                            className="flex items-center gap-1 text-[10px] hover:text-violet-600 transition-colors"
                            onClick={() => {
                              setCreativesTarget(ad);
                              setUploadingFiles([]);
                              setCreativesOpen(true);
                            }}
                          >
                            <FileImage size={10} />
                            {approved}/{ad.creatives.length} approved
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] text-muted-foreground">
                            {ad.startDate}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            → {ad.endDate}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${SC.color}`}>
                            {SC.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setSelectedAd(ad);
                                setDetailOpen(true);
                              }}
                            >
                              <Eye size={11} />
                            </Button>
                            {(ad.status === "active" ||
                              ad.status === "paused") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-6 w-6 p-0 ${ad.status === "active" ? "text-yellow-500" : "text-green-500"}`}
                                onClick={() => handleToggle(ad)}
                              >
                                {ad.status === "active" ? (
                                  <Pause size={11} />
                                ) : (
                                  <Play size={11} />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "creatives" && (
        <div className="space-y-4">
          {/* Global Upload Card */}
          <Card className="border-dashed border-2 border-violet-300 bg-violet-500/3">
            <CardContent className="p-6">
              <div className="text-center space-y-3">
                <div className="flex justify-center gap-3">
                  <div className="p-3 rounded-full bg-violet-500/10">
                    <Image size={22} className="text-violet-500" />
                  </div>
                  <div className="p-3 rounded-full bg-violet-500/10">
                    <Video size={22} className="text-violet-500" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Upload Banners or Videos
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    PNG, JPG, GIF for banners · MP4, MOV for videos · Max 100MB
                    per file
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 items-center justify-center">
                  <Select
                    value={globalCreativesTarget}
                    onValueChange={setGlobalCreativesTarget}
                  >
                    <SelectTrigger className="text-xs h-8 w-52">
                      <SelectValue placeholder="Select campaign..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ads.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">
                          {a.tenantName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <input
                    ref={globalFileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      handleGlobalUpload(files);
                      e.target.value = "";
                    }}
                  />

                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 h-8 border-violet-400 text-violet-600"
                    onClick={() => {
                      if (!globalCreativesTarget) {
                        toast.error("Select a campaign first");
                        return;
                      }
                      globalFileInputRef.current?.click();
                    }}
                  >
                    <Upload size={12} /> Choose & Upload Files
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* All Creatives Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileImage size={14} className="text-violet-500" /> All
                Creatives
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>File</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Campaign / Tenant</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allCreatives.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-xs text-muted-foreground py-8"
                      >
                        No creatives uploaded yet
                      </TableCell>
                    </TableRow>
                  )}
                  {allCreatives.map((c) => {
                    const CS = CREATIVE_STATUS_CONFIG[c.status];
                    return (
                      <TableRow key={c.id} className="text-xs">
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {c.type === "video" ? (
                              <Video
                                size={12}
                                className="text-blue-500 shrink-0"
                              />
                            ) : (
                              <Image
                                size={12}
                                className="text-violet-500 shrink-0"
                              />
                            )}
                            <span className="font-mono text-[10px] truncate max-w-[160px]">
                              {c.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[10px] ${c.type === "video" ? "bg-blue-500/15 text-blue-600 border-blue-500/30" : "bg-violet-500/15 text-violet-600 border-violet-500/30"}`}
                          >
                            {c.type === "video" ? "Video" : "Banner"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] font-medium">
                            {c.tenantName}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                            {c.adTitle}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[10px]">
                          {c.size}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {c.uploadedOn}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${CS.color}`}>
                            {CS.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            {c.status === "pending" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] text-green-600"
                                  onClick={() =>
                                    approveCreative(c.id, "approved")
                                  }
                                >
                                  <CheckCircle2 size={10} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] text-red-500"
                                  onClick={() =>
                                    approveCreative(c.id, "rejected")
                                  }
                                >
                                  <X size={10} />
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                              onClick={() => handleDeleteCreative(c.adId, c.id)}
                            >
                              <Trash2 size={10} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
      </DbaShell>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BarChart3 size={14} className="text-violet-500" /> Campaign
              Analytics
            </DialogTitle>
          </DialogHeader>
          {selectedAd && (
            <div className="space-y-4 py-1">
              <div>
                <p className="font-semibold text-sm">{selectedAd.title}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedAd.description}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Impressions",
                    value: selectedAd.impressions.toLocaleString(),
                    icon: Eye,
                  },
                  {
                    label: "Clicks",
                    value: selectedAd.clicks.toLocaleString(),
                    icon: MousePointer,
                  },
                  {
                    label: "CTR",
                    value: `${ctr(selectedAd)}%`,
                    icon: TrendingUp,
                  },
                  {
                    label: "Total Spend",
                    value: `₹${selectedAd.spent.toLocaleString()}`,
                    icon: DollarSign,
                  },
                  {
                    label: "Platform (40%)",
                    value: `₹${Math.round(selectedAd.spent * 0.4).toLocaleString()}`,
                    icon: Star,
                  },
                  {
                    label: "Creatives",
                    value: `${selectedAd.creatives.filter((c) => c.status === "approved").length} approved`,
                    icon: FileImage,
                  },
                ].map((m, i) => (
                  <div
                    key={i}
                    className="bg-muted/50 rounded-lg p-2.5 text-center"
                  >
                    <m.icon
                      size={12}
                      className="mx-auto mb-1 text-muted-foreground"
                    />
                    <div className="font-bold text-sm">{m.value}</div>
                    <div className="text-[9px] text-muted-foreground">
                      {m.label}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Budget Used</span>
                  <span className="font-bold">
                    ₹{selectedAd.spent.toLocaleString()} / ₹
                    {selectedAd.budget.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full"
                    style={{
                      width: `${Math.min((selectedAd.spent / selectedAd.budget) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDetailOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-campaign creatives dialog */}
      <Dialog
        open={creativesOpen}
        onOpenChange={(v) => {
          setCreativesOpen(v);
          if (!v) setUploadingFiles([]);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileImage size={14} className="text-violet-500" />
              Creatives — {creativesTarget?.tenantName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div
              className="border-2 border-dashed border-violet-300 rounded-lg p-4 text-center cursor-pointer hover:bg-violet-500/5 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={18} className="mx-auto text-violet-400 mb-1" />
              <p className="text-xs text-muted-foreground">
                Click to upload banners or videos
              </p>
              <p className="text-[10px] text-muted-foreground">
                PNG, JPG, GIF, MP4, MOV · Max 100MB
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                setUploadingFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />

            {uploadingFiles.length > 0 && (
              <div className="space-y-1">
                {uploadingFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {f.type.startsWith("video") ? (
                        <Video size={10} className="text-blue-500" />
                      ) : (
                        <Image size={10} className="text-violet-500" />
                      )}
                      <span className="truncate max-w-[200px]">{f.name}</span>
                    </div>
                    <button
                      onClick={() =>
                        setUploadingFiles((p) => p.filter((_, j) => j !== i))
                      }
                    >
                      <X
                        size={10}
                        className="text-muted-foreground hover:text-red-500"
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {creativesTarget && creativesTarget.creatives.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Uploaded Creatives
                </p>
                {creativesTarget.creatives.map((c) => {
                  const CS = CREATIVE_STATUS_CONFIG[c.status];
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between border rounded px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {c.type === "video" ? (
                          <Video size={11} className="text-blue-500" />
                        ) : (
                          <Image size={11} className="text-violet-500" />
                        )}
                        <span className="truncate max-w-[200px] font-mono text-[10px]">
                          {c.name}
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          {c.size}
                        </span>
                      </div>
                      <Badge className={`text-[9px] ${CS.color}`}>
                        {CS.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {creativesTarget?.creatives.length === 0 &&
              uploadingFiles.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  No creatives yet for this campaign
                </p>
              )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setCreativesOpen(false);
                setUploadingFiles([]);
              }}
            >
              Close
            </Button>
            {uploadingFiles.length > 0 && (
              <Button
                size="sm"
                className="text-xs gap-1 bg-violet-600 hover:bg-violet-700"
                onClick={handleUploadFromDialog}
              >
                <Upload size={11} /> Upload {uploadingFiles.length} File
                {uploadingFiles.length > 1 ? "s" : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Plus size={13} className="text-violet-500" /> New Ad Campaign
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="bg-violet-500/8 border border-violet-200 rounded p-2.5 flex items-start gap-2">
              <PhoneCall
                size={12}
                className="text-violet-500 mt-0.5 shrink-0"
              />
              <p className="text-[10px] text-violet-700">
                This campaign will be fully managed by DBA. Platform retains 40%
                of all ad spend as the service fee.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tenant *</Label>
              <Select
                value={form.tenantId}
                onValueChange={(v) => {
                  const names: Record<string, string> = {
                    "T-001": "Civilier Constructions Pvt Ltd",
                    "T-002": "Buildtech Infrastructure Ltd",
                    "T-003": "Apex Realty Developers",
                    "T-004": "Metro Projects Group",
                  };
                  setForm((f) => ({
                    ...f,
                    tenantId: v,
                    tenantName: names[v] ?? v,
                  }));
                }}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="T-001" className="text-xs">
                    Civilier Constructions Pvt Ltd
                  </SelectItem>
                  <SelectItem value="T-002" className="text-xs">
                    Buildtech Infrastructure Ltd
                  </SelectItem>
                  <SelectItem value="T-003" className="text-xs">
                    Apex Realty Developers
                  </SelectItem>
                  <SelectItem value="T-004" className="text-xs">
                    Metro Projects Group
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Campaign Title *</Label>
              <Input
                className="text-xs h-8"
                placeholder="e.g. Brand Awareness Q2 2026"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea
                className="text-xs min-h-[60px] resize-none"
                placeholder="Brief campaign description..."
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Budget (₹) *</Label>
                <Input
                  className="text-xs h-8"
                  placeholder="50000"
                  value={form.budget}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, budget: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Brand Awareness" className="text-xs">
                      Brand Awareness
                    </SelectItem>
                    <SelectItem value="Lead Generation" className="text-xs">
                      Lead Generation
                    </SelectItem>
                    <SelectItem value="Promotions" className="text-xs">
                      Promotions
                    </SelectItem>
                    <SelectItem value="Retargeting" className="text-xs">
                      Retargeting
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start Date *</Label>
                <Input
                  type="date"
                  className="text-xs h-8"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date *</Label>
                <Input
                  type="date"
                  className="text-xs h-8"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="border-t pt-2 space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Creative
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Creative Type *</Label>
                <select
                  className="w-full text-xs h-8 rounded-md border border-input bg-background px-3"
                  value={form.creativeType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, creativeType: e.target.value }))
                  }
                >
                  {["Banner", "Video", "Carousel", "Text", "Native"].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <div className="border-t pt-2 space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Tenant Contact
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Contact Name</Label>
                  <Input
                    className="text-xs h-8"
                    placeholder="e.g. Rajesh Kumar"
                    value={form.contactName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contactName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Contact Email *</Label>
                  <Input
                    type="email"
                    className="text-xs h-8"
                    placeholder="billing@company.in"
                    value={form.contactEmail}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contactEmail: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contact Phone</Label>
                <Input
                  className="text-xs h-8"
                  placeholder="+91 98765 43210"
                  value={form.contactPhone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contactPhone: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs bg-violet-600 hover:bg-violet-700"
              onClick={handleCreate}
            >
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}