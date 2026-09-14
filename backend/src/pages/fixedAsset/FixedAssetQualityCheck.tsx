import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Search, Building2, Package, Calendar, FileText, Hash,
  Check, X, Boxes, User, ChevronsUpDown, Loader2, UserRound, ShieldCheck,
  Eye, Pencil, Trash2, AlertTriangle, Image as ImageIcon,
  Bell, CalendarClock, CalendarPlus, CircleAlert, CheckCircle2, Ban, Camera as CameraIcon,
} from "lucide-react";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getQCAssets, getAssetContext, getQualityChecks, getQualityCheck,
  createQualityCheck, updateQualityCheck, setFollowUpStatus, deleteQualityCheck,
  QUALITY_STATUSES, FOLLOWUP_TYPES, FOLLOWUP_STATUSES,
  type QCAsset, type QualityCheckItem, type QualityStatus, type FollowUpStatus,
} from "@/api/fixedAssetQualityCheckApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN").format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const inputCls   = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-60";
const labelCls   = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";

const QUALITY_COLORS: Record<QualityStatus, string> = {
  Good:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Average:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Defective: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Repairing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const FU_COLORS: Record<FollowUpStatus, string> = {
  Pending:   "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  Completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Cancelled: "bg-muted text-muted-foreground",
};

const avatarColors = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-indigo-500",
];
function initials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function UserAvatar({ id, name, avatarUrl, size = 24 }: { id: number; name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 ${avatarColors[id % avatarColors.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(name) || "?"}
    </span>
  );
}
function SectionHeader({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
        <Icon size={14} />
      </span>
      <p className="text-sm font-semibold text-foreground">{children}</p>
    </div>
  );
}
function SummaryCard({ label, value, color = "", icon: Icon }: { label: string; value: string; color?: string; icon?: React.ElementType }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3 text-center">
      {Icon && <Icon size={13} className={`mx-auto mb-1 ${color || "text-muted-foreground"}`} />}
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

// ── FA Item Code combobox ────────────────────────────────────────────────────
function FAItemCodeCombobox({
  assets, value, onSelect, loading, disabled,
}: { assets: QCAsset[]; value: string; onSelect: (a: QCAsset) => void; loading?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground")}>
          <span className="truncate">{selected ? `${selected.FAItemCode} — ${selected.AssetName}` : "Select FA Item Code…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>No Fixed Asset Records found.</CommandEmpty>
                <CommandGroup>
                  {assets.map((a) => (
                    <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName}`}
                      onSelect={() => { onSelect(a); setOpen(false); }}
                      className="data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50">
                      <Check className={cn("mr-2 h-4 w-4", String(a.AssetId) === value ? "opacity-100" : "opacity-0")} />
                      <span className="flex flex-col min-w-0">
                        <span className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400 truncate">{a.FAItemCode}</span>
                        <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}


// ── Item Picture: record-wise image, camera-only capture (no gallery) ───────
// Shows the previous/latest image for reference until a new photo is captured;
// the captured image is saved against THIS Quality Check record only.
function ItemPictureField({
  image, isNew, captured, hint, disabled, onCapture, onView,
}: {
  image: string | null; isNew: boolean; captured: boolean;
  hint?: string; disabled?: boolean;
  onCapture: (dataUrl: string) => void;
  onView?: (src: string) => void;
}) {
  const [camOpen, setCamOpen] = React.useState(false);
  const showingReference = isNew && !captured && !!image;
  return (
    <div>
      <label className={labelCls}><ImageIcon size={11} /> Item Picture</label>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
        {image ? (
          <img src={image} alt="Item" onClick={() => onView?.(image)}
            className={`h-16 w-16 shrink-0 rounded-lg border border-border object-cover cursor-zoom-in ${showingReference ? "opacity-60" : ""}`} />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-border bg-muted/20 flex items-center justify-center text-muted-foreground">
            <ImageIcon size={18} />
          </div>
        )}
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className="text-[11px] text-muted-foreground">
            {disabled ? "Select an FA Item Code first"
              : captured ? "New photo — saved with this record"
              : showingReference ? (hint || "Previous image (reference only)")
              : image ? "This record's picture"
              : "No item picture yet — capture one"}
          </p>
          <button type="button" disabled={disabled} onClick={() => setCamOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 text-white px-3 py-1.5 text-xs font-semibold hover:shadow transition-all disabled:opacity-50 w-fit">
            <CameraIcon size={13} />
            {captured || image ? "Retake with Camera" : "Capture with Camera"}
          </button>
        </div>
      </div>
      {camOpen && <CameraCaptureModal onCapture={onCapture} onClose={() => setCamOpen(false)} />}
    </div>
  );
}

// ── User Photo: strictly read-only on this page ─────────────────────────────
function ReadOnlyUserPhoto({ image, disabled, onView }: { image: string | null; disabled?: boolean; onView?: (src: string) => void }) {
  return (
    <div>
      <label className={labelCls}><UserRound size={11} /> User Photo <span className="text-[10px] font-normal text-muted-foreground">(read-only)</span></label>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {image ? (
          <img src={image} alt="User" onClick={() => onView?.(image)} className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover opacity-95 cursor-zoom-in" />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-border bg-muted/40 flex items-center justify-center text-muted-foreground">
            <UserRound size={20} />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {disabled ? "Select an FA Item Code first"
            : image ? "From the Assignment record — change it on the Assignment page."
            : "No User Photo Available"}
        </p>
      </div>
    </div>
  );
}

interface FormState {
  docDate: string;
  companyId: string;
  projectId: string;
  assetId: string;
  qualityStatus: QualityStatus | "";
  remarks: string;
  nextFollowUpDate: string;
  followUpType: string;
  followUpRemarks: string;
  responsibleUserId: string;
  followUpStatus: FollowUpStatus;
  lastFollowUpDate: string;
  nextActionNotes: string;
}
const emptyForm = (): FormState => ({
  docDate: new Date().toISOString().slice(0, 10),
  companyId: "", projectId: "", assetId: "",
  qualityStatus: "", remarks: "",
  nextFollowUpDate: "", followUpType: "", followUpRemarks: "",
  responsibleUserId: "", followUpStatus: "Pending", lastFollowUpDate: "", nextActionNotes: "",
});

type ViewMode = "list" | "form";

export default function FixedAssetQualityCheck() {
  const rights = usePageRights("fixed-asset-quality-check");
  const qc = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | FollowUpStatus | "Overdue">("");
  // user photo: undefined = use context photo; string/null = a pending change
  // undefined = use the asset's stored picture; string/null = a change made here
  const [localItemPic, setLocalItemPic] = useState<string | null | undefined>(undefined);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ["fa-quality-checks"],
    queryFn: () => getQualityChecks(),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: qcAssets = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["fa-qc-assets", form.companyId, form.projectId],
    queryFn: () => getQCAssets({
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
    }),
    enabled: viewMode === "form",
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  // ── asset context (auto-fetch on FA Item Code) ───────────────────────────
  const { data: ctx, isFetching: ctxLoading } = useQuery({
    queryKey: ["fa-qc-asset-context", form.assetId],
    queryFn: () => getAssetContext(Number(form.assetId)),
    enabled: viewMode === "form" && !!form.assetId,
  });

  // Responsible User is NOT user-editable here — it always mirrors the FA
  // Item Code's current Assignment. Keep the form value in sync with ctx so
  // the preview/payload reflect the live assignment (incl. after a transfer).
  React.useEffect(() => {
    if (!form.assetId) return;
    const fromAssignment = ctx?.responsibleUserId ? String(ctx.responsibleUserId) : "";
    setForm((p) => (p.responsibleUserId === fromAssignment ? p : { ...p, responsibleUserId: fromAssignment }));
  }, [ctx?.responsibleUserId, form.assetId]);

  // ── edit populate ───────────────────────────────────────────────────────
  const { data: editDetail } = useQuery({
    queryKey: ["fa-quality-check", editingId],
    queryFn: () => getQualityCheck(editingId!),
    enabled: editingId != null && viewMode === "form",
  });
  React.useEffect(() => {
    if (editingId && editDetail) {
      const d = editDetail;
      setForm({
        docDate: d.DocDate?.slice(0, 10) || "",
        companyId: String(d.CompanyId || ""),
        projectId: String(d.ProjectId || ""),
        assetId: String(d.AssetId || ""),
        qualityStatus: d.QualityStatus,
        remarks: d.Remarks || "",
        nextFollowUpDate: d.NextFollowUpDate?.slice(0, 10) || "",
        followUpType: d.FollowUpType || "",
        followUpRemarks: d.FollowUpRemarks || "",
        responsibleUserId: String(d.ResponsibleUserId || ""),
        followUpStatus: d.FollowUpStatus,
        lastFollowUpDate: d.LastFollowUpDate?.slice(0, 10) || "",
        nextActionNotes: d.NextActionNotes || "",
      });
      setLocalItemPic(undefined);
    }
  }, [editingId, editDetail]);

  const { data: viewDetail } = useQuery({
    queryKey: ["fa-quality-check", viewingId],
    queryFn: () => getQualityCheck(viewingId!),
    enabled: viewingId != null,
  });

  // ── derived ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const live = ensureArray<QualityCheckItem>(checks);
    return {
      total: live.length,
      pending: live.filter((c) => c.FollowUpStatus === "Pending").length,
      overdue: live.filter((c) => c.IsOverdue === 1).length,
      completed: live.filter((c) => c.FollowUpStatus === "Completed").length,
    };
  }, [checks]);

  const filtered = useMemo(() => {
    let r = ensureArray<QualityCheckItem>(checks);
    if (filterStatus === "Overdue") r = r.filter((c) => c.IsOverdue === 1);
    else if (filterStatus) r = r.filter((c) => c.FollowUpStatus === filterStatus);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((c) =>
        (c.DocNo || "").toLowerCase().includes(s) ||
        (c.FAItemCode || "").toLowerCase().includes(s) ||
        (c.ItemName || "").toLowerCase().includes(s) ||
        (c.CurrentUserName || "").toLowerCase().includes(s) ||
        (c.ResponsibleUserName || "").toLowerCase().includes(s));
    }
    return r;
  }, [checks, search, filterStatus]);

  // ── mutations ───────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fa-quality-checks"] });
    qc.invalidateQueries({ queryKey: ["fa-quality-check"] });
  };
  const createMut = useMutation({
    mutationFn: createQualityCheck,
    onSuccess: (r) => { toast.success(`Quality check saved — ${r.docNo}`); invalidate(); resetForm(); setViewMode("list"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateQualityCheck>[1] }) => updateQualityCheck(id, data),
    onSuccess: () => { toast.success("Quality check updated"); invalidate(); resetForm(); setViewMode("list"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: FollowUpStatus }) => setFollowUpStatus(id, status),
    onSuccess: () => { toast.success("Follow-up updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteQualityCheck,
    onSuccess: () => { toast.success("Record deleted"); invalidate(); setDeleteId(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetForm = () => { setForm(emptyForm()); setEditingId(null); setLocalItemPic(undefined); };
  const goToCreate = () => { resetForm(); setViewMode("form"); };
  const goToEdit = (c: QualityCheckItem) => { resetForm(); setEditingId(c.QualityCheckId); setViewMode("form"); };

  // "Generate follow-up" — start a NEW quality-check for the same FA Item Code,
  // continuing the chain: carry the asset/company/project, default type to
  // Recheck, and record this row's follow-up date as the Last Follow-Up.
  const goToFollowUp = (c: QualityCheckItem) => {
    resetForm();
    setViewingId(null);
    setForm({
      ...emptyForm(),
      companyId: String(c.CompanyId || ""),
      projectId: String(c.ProjectId || ""),
      assetId: String(c.AssetId || ""),
      followUpType: "Recheck",
      lastFollowUpDate: (c.NextFollowUpDate || c.DocDate || "").slice(0, 10),
    });
    setViewMode("form");
  };

  const handleSelectAsset = (a: QCAsset) => {
    setLocalItemPic(undefined);
    setForm((p) => ({
      ...p,
      assetId: String(a.AssetId),
      companyId: p.companyId || (a.CompanyId ? String(a.CompanyId) : ""),
      projectId: p.projectId || (a.ProjectId ? String(a.ProjectId) : ""),
    }));
  };

  const handleSave = () => {
    if (!form.assetId) return toast.error("FA Item Code is required");
    if (!form.qualityStatus) return toast.error("Quality Status is required");
    if (!form.nextFollowUpDate) return toast.error("Next Follow-Up Date is required");

    const payload = {
      docDate: form.docDate || undefined,
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      assetId: Number(form.assetId),
      qualityStatus: form.qualityStatus,
      remarks: form.remarks || undefined,
      // Only send the image when the user captured one on this form — the
      // captured photo is saved against THIS record only; existing records
      // keep their own image untouched.
      ...(localItemPic !== undefined ? { itemPicture: localItemPic } : {}),
      nextFollowUpDate: form.nextFollowUpDate,
      followUpType: form.followUpType || undefined,
      followUpRemarks: form.followUpRemarks || undefined,
      responsibleUserId: form.responsibleUserId ? Number(form.responsibleUserId) : null,
      followUpStatus: form.followUpStatus,
      lastFollowUpDate: form.lastFollowUpDate || undefined,
      nextActionNotes: form.nextActionNotes || undefined,
    };
    if (editingId) updateMut.mutate({ id: editingId, data: payload });
    else createMut.mutate(payload);
  };

  const saving = createMut.isPending || updateMut.isPending;
  const currentUserName = ctx?.currentUserName ?? editDetail?.CurrentUserName ?? null;
  const itemName = ctx?.itemName ?? editDetail?.ItemName ?? null;
  // On edit: this record's own saved image. On create: the previous/latest
  // image for the asset (reference only, until a new one is captured).
  const storedItemPicture = editingId ? (editDetail?.ItemPicture ?? null) : (ctx?.itemPicture ?? null);
  const effectiveItemPicture = localItemPic !== undefined ? localItemPic : storedItemPicture;
  const itemPicHint = !editingId && ctx?.itemPictureFromDocNo
    ? `Previous image — from ${ctx.itemPictureFromDocNo}${ctx.itemPictureFromDate ? " · " + fmtDate(ctx.itemPictureFromDate) : ""} (reference only)`
    : undefined;

  // ═════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title={editingId ? "Edit Quality Check" : "New Quality Check"}
        subtitle="Owner, asset condition & follow-up tracking"
        icon={ShieldCheck}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Check size={13} /> {saving ? "Saving…" : editingId ? "Update" : "Save Record"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 xl:gap-8 items-start w-full max-w-[1400px]">
        <div className="space-y-5 min-w-0">

          {/* ── Owner & Asset Details ── */}
          <div className={sectionCls}>
            <SectionHeader icon={Package}>Owner &amp; Asset Details</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Building2 size={11} /> Company *</label>
                <select value={form.companyId} disabled={!!editingId}
                  onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "", assetId: "" }))}
                  className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project *</label>
                <select value={form.projectId} disabled={!form.companyId || !!editingId}
                  onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, assetId: "" }))}
                  className={inputCls}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Check Date</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelCls}><Hash size={11} /> FA Item Code *</label>
                {editingId ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{itemName || editDetail?.ItemName || "—"}</p>
                      <p className="text-[11px] font-mono text-yellow-600 dark:text-yellow-400 truncate">{editDetail?.FAItemCode || "—"}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">Fixed for this record</span>
                  </div>
                ) : (
                  <FAItemCodeCombobox assets={ensureArray<QCAsset>(qcAssets)} value={form.assetId} loading={loadingAssets}
                    onSelect={handleSelectAsset} />
                )}
              </div>

              {/* auto-fetched */}
              <div>
                <label className={labelCls}><UserRound size={11} /> User (current owner)</label>
                <div className={`${inputCls} h-auto min-h-9 py-1.5 flex items-center gap-2 bg-muted/30`}>
                  {ctxLoading ? <Loader2 size={13} className="animate-spin text-muted-foreground" />
                    : currentUserName ? (
                      <>
                        <UserAvatar id={ctx?.currentUserId || 0} name={currentUserName} avatarUrl={ctx?.currentUserAvatar} size={20} />
                        <span className="text-sm font-medium truncate">{currentUserName}</span>
                      </>
                    ) : <span className="text-xs text-muted-foreground">{form.assetId ? "No assignment found" : "Select an FA Item Code"}</span>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Item Name</label>
                <input type="text" readOnly value={itemName || ""} placeholder="Auto-filled from FA Item Code"
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
              </div>
              <div>
                <label className={labelCls}>Quality Status *</label>
                <select value={form.qualityStatus} onChange={(e) => setField("qualityStatus", e.target.value as QualityStatus)} className={inputCls}>
                  <option value="">Select…</option>
                  {QUALITY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <ReadOnlyUserPhoto
                image={ctx?.userPhoto || null}
                disabled={!form.assetId}
                onView={(src) => setLightbox({ src, label: "User Photo" })}
              />
              <ItemPictureField
                image={effectiveItemPicture}
                isNew={!editingId}
                captured={localItemPic !== undefined}
                hint={itemPicHint}
                disabled={!form.assetId}
                onCapture={(d) => setLocalItemPic(d)}
                onView={(src) => setLightbox({ src, label: "Item Picture" })}
              />

              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelCls}>Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)}
                  placeholder="Optional…" className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Follow-Up / Next Update ── */}
          <div className={sectionCls}>
            <SectionHeader icon={CalendarClock}>Follow-Up / Next Update</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Bell size={11} /> Next Follow-Up Date *</label>
                <input type="date" value={form.nextFollowUpDate} onChange={(e) => setField("nextFollowUpDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Follow-Up Type</label>
                <select value={form.followUpType} onChange={(e) => setField("followUpType", e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {FOLLOWUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><User size={11} /> Responsible User <span className="text-[10px] font-normal text-muted-foreground">(auto · read-only)</span></label>
                <div className={`${inputCls} h-auto min-h-9 py-1.5 flex items-center gap-2 bg-muted/30`}>
                  {ctxLoading && form.assetId ? (
                    <Loader2 size={13} className="animate-spin text-muted-foreground" />
                  ) : ctx?.responsibleUserName ? (
                    <>
                      <UserAvatar id={ctx.responsibleUserId || 0} name={ctx.responsibleUserName} avatarUrl={ctx.responsibleUserAvatar} size={20} />
                      <span className="text-sm font-medium truncate">{ctx.responsibleUserName}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">{form.assetId ? "No Responsible User Assigned" : "Select an FA Item Code"}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">From this FA Item Code's current Assignment — set it on the Assignment page.</p>
              </div>
              <div>
                <label className={labelCls}>Follow-Up Status</label>
                <select value={form.followUpStatus} onChange={(e) => setField("followUpStatus", e.target.value as FollowUpStatus)} className={inputCls}>
                  {FOLLOWUP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Last Follow-Up Date</label>
                <input type="date" value={form.lastFollowUpDate} onChange={(e) => setField("lastFollowUpDate", e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className={labelCls}>Follow-Up Remarks</label>
                <input type="text" value={form.followUpRemarks} onChange={(e) => setField("followUpRemarks", e.target.value)}
                  placeholder="Optional…" className={inputCls} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelCls}>Next Action / Notes</label>
                <input type="text" value={form.nextActionNotes} onChange={(e) => setField("nextActionNotes", e.target.value)}
                  placeholder="What to do next…" className={inputCls} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Bell size={11} /> A reminder is sent to the Responsible User on the follow-up date and each day it stays overdue, until it's marked Completed or Cancelled.
            </p>
          </div>
        </div>

        {/* ── preview ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden h-fit shadow-lg shadow-black/5 dark:shadow-black/20">
          <div className="bg-gradient-to-br from-yellow-500 via-amber-500 to-yellow-700 p-4 text-white">
            <p className="text-[10px] uppercase tracking-wide text-white/70 mb-1.5">Quality Check</p>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 shrink-0"><ShieldCheck size={16} /></span>
              <p className="text-sm font-bold truncate">{itemName || "New Record"}</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {effectiveItemPicture && <img src={effectiveItemPicture} alt="Asset" onClick={() => setLightbox({ src: effectiveItemPicture, label: "Item Picture" })} className="w-full h-32 rounded-lg object-cover cursor-zoom-in" />}
            <div className="space-y-2 text-xs">
              {[
                ["Current User", currentUserName || "—"],
                ["Quality", form.qualityStatus || "—"],
                ["Next Follow-Up", form.nextFollowUpDate ? fmtDate(form.nextFollowUpDate) : "—"],
                ["Follow-Up Type", form.followUpType || "—"],
                ["Responsible", ctx?.responsibleUserName || (editDetail?.ResponsibleUserName ?? "—")],
                ["Status", form.followUpStatus],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-right truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </GlassShell>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Owner & Quality Checking"]} />
    <GlassShell
      title="Owner & Quality Checking"
      subtitle="Track the current owner, asset condition and follow-up activities"
      icon={ShieldCheck}
      accentColor="#eab308"
      action={rights.canCreate && (
        <button onClick={goToCreate}
          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
          <Plus size={13} /> New Quality Check
        </button>
      )}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total Records" value={fmt(stats.total)} icon={Boxes} />
        <SummaryCard label="Pending Follow-Ups" value={fmt(stats.pending)} color="text-violet-600 dark:text-violet-400" icon={CalendarClock} />
        <SummaryCard label="Overdue" value={fmt(stats.overdue)} color="text-red-600 dark:text-red-400" icon={CircleAlert} />
        <SummaryCard label="Completed" value={fmt(stats.completed)} color="text-emerald-600 dark:text-emerald-400" icon={CheckCircle2} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className={labelCls}>Search</label>
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Doc no, FA Item Code, item, user…" className={`${inputCls} pl-8`} />
              {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
            </div>
          </div>
          <div>
            <label className={labelCls}>Follow-Up</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className={`${inputCls} sm:w-44`}>
              <option value="">All</option>
              <option value="Overdue">Overdue only</option>
              {FOLLOWUP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Quality Check &amp; Follow-Up History</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Complete history per FA Item Code</p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60"><ShieldCheck size={26} className="opacity-40" /></span>
              <p className="text-sm">No quality checks found</p>
              {rights.canCreate && (
                <button onClick={goToCreate} className="mt-2 inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600">
                  <Plus size={13} /> Add First Record
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1120px]">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Doc No</th>
                    <th className="px-4 py-3 text-left">FA Item Code</th>
                    <th className="px-4 py-3 text-left">Current User</th>
                    <th className="px-4 py-3 text-left">Quality</th>
                    <th className="px-4 py-3 text-left">Next Follow-Up</th>
                    <th className="px-4 py-3 text-left">Responsible</th>
                    <th className="px-4 py-3 text-left">Follow-Up</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr key={c.QualityCheckId} onClick={() => setViewingId(c.QualityCheckId)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-mono text-xs">
                        {c.DocNo || "—"}
                        <span className="block text-[10px] font-sans text-muted-foreground">{fmtDate(c.DocDate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-yellow-600 dark:text-yellow-400 truncate">{c.FAItemCode || "—"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{c.ItemName || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {c.CurrentUserName ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <UserAvatar id={c.CurrentUserId || 0} name={c.CurrentUserName} avatarUrl={c.CurrentUserAvatar} size={18} />
                            <span className="font-medium">{c.CurrentUserName}</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${QUALITY_COLORS[c.QualityStatus]}`}>{c.QualityStatus}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={c.IsOverdue ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"}>
                          {fmtDate(c.NextFollowUpDate)}
                        </span>
                        {c.IsOverdue === 1 && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                            <CircleAlert size={10} /> OVERDUE
                          </span>
                        )}
                        {c.FollowUpType && <span className="block text-[10px] text-muted-foreground">{c.FollowUpType}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {c.ResponsibleUserName ? (
                          <div className="flex items-center gap-1.5">
                            <UserAvatar id={c.ResponsibleUserId || 0} name={c.ResponsibleUserName} avatarUrl={c.ResponsibleUserAvatar} size={18} />
                            <span>{c.ResponsibleUserName}</span>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${FU_COLORS[c.FollowUpStatus]}`}>{c.FollowUpStatus}</span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {rights.canCreate && (
                            <button onClick={() => goToFollowUp(c)} title="Generate follow-up for this FA Item Code"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 hover:bg-muted transition-colors"><CalendarPlus size={14} /></button>
                          )}
                          <button onClick={() => setViewingId(c.QualityCheckId)} title="View"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Eye size={14} /></button>
                          {rights.canEdit && c.FollowUpStatus === "Pending" && (
                            <button onClick={() => statusMut.mutate({ id: c.QualityCheckId, status: "Completed" })} title="Mark follow-up completed"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-muted transition-colors"><CheckCircle2 size={14} /></button>
                          )}
                          {rights.canEdit && c.FollowUpStatus === "Pending" && (
                            <button onClick={() => statusMut.mutate({ id: c.QualityCheckId, status: "Cancelled" })} title="Cancel follow-up"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 hover:bg-muted transition-colors"><Ban size={14} /></button>
                          )}
                          {rights.canEdit && (
                            <button onClick={() => goToEdit(c)} title="Edit"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400 hover:bg-muted transition-colors"><Pencil size={14} /></button>
                          )}
                          {rights.canDelete && (
                            <button onClick={() => setDeleteId(c.QualityCheckId)} title="Delete"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-muted transition-colors"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── View drawer ── */}
      {viewingId != null && createPortal(
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setViewingId(null)} />
          <div className="w-full max-w-sm bg-card border-l border-border flex flex-col shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"><ShieldCheck size={15} /></span>
                <h2 className="text-base font-semibold">Quality Check</h2>
              </div>
              <button onClick={() => setViewingId(null)} className="p-1.5 rounded hover:bg-muted transition-colors"><X size={16} /></button>
            </div>
            {!viewDetail ? (
              <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex gap-3">
                  {viewDetail.ItemPicture && (
                    <button type="button" onClick={() => setLightbox({ src: viewDetail.ItemPicture!, label: `Item Picture · ${viewDetail.DocNo || ""}` })}
                      className="group relative rounded-lg overflow-hidden" title="View full size">
                      <img src={viewDetail.ItemPicture} alt="Item" className="h-20 w-20 rounded-lg border border-border object-cover transition-transform group-hover:scale-[1.03]" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[9px] text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">Item Picture</span>
                    </button>
                  )}
                  {viewDetail.UserPhoto && (
                    <button type="button" onClick={() => setLightbox({ src: viewDetail.UserPhoto!, label: "User Photo" })}
                      className="group relative rounded-lg overflow-hidden" title="View full size">
                      <img src={viewDetail.UserPhoto} alt="User" className="h-20 w-20 rounded-lg border border-border object-cover transition-transform group-hover:scale-[1.03]" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[9px] text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">User Photo</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${QUALITY_COLORS[viewDetail.QualityStatus]}`}>{viewDetail.QualityStatus}</span>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${FU_COLORS[viewDetail.FollowUpStatus]}`}>{viewDetail.FollowUpStatus}</span>
                  {viewDetail.IsOverdue === 1 && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400"><CircleAlert size={11} /> Overdue</span>}
                </div>
                <div className="space-y-2.5 text-sm border-t border-border pt-3">
                  {[
                    ["Doc No", viewDetail.DocNo || "—"],
                    ["Check Date", fmtDate(viewDetail.DocDate)],
                    ["FA Item Code", viewDetail.FAItemCode || "—"],
                    ["Item Name", viewDetail.ItemName || "—"],
                    ["Asset Code", viewDetail.AssetCode || "—"],
                    ["Current User", viewDetail.CurrentUserName || "—"],
                    ["Company", viewDetail.CompanyName || "—"],
                    ["Project", viewDetail.ProjectName || "—"],
                    ["Remarks", viewDetail.Remarks || "—"],
                    ["Next Follow-Up", fmtDate(viewDetail.NextFollowUpDate)],
                    ["Follow-Up Type", viewDetail.FollowUpType || "—"],
                    ["Follow-Up Remarks", viewDetail.FollowUpRemarks || "—"],
                    ["Responsible User", viewDetail.ResponsibleUserName || "—"],
                    ["Last Follow-Up", fmtDate(viewDetail.LastFollowUpDate)],
                    ["Next Action / Notes", viewDetail.NextActionNotes || "—"],
                    ["Created By", viewDetail.CreatedBy || "—"],
                    ...(viewDetail.CompletedAt ? [["Closed", `${viewDetail.CompletedBy || ""} · ${fmtDate(viewDetail.CompletedAt)}`]] as [string, string][] : []),
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{k}</span>
                      <span className="font-medium text-right break-words">{v}</span>
                    </div>
                  ))}
                </div>
                {viewDetail.FollowUpStatus === "Pending" && rights.canEdit && (
                  <div className="flex gap-2 border-t border-border pt-3">
                    <button onClick={() => { statusMut.mutate({ id: viewDetail.QualityCheckId, status: "Completed" }); setViewingId(null); }}
                      className="flex-1 h-9 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors inline-flex items-center justify-center gap-1.5">
                      <CheckCircle2 size={13} /> Mark Completed
                    </button>
                    <button onClick={() => { statusMut.mutate({ id: viewDetail.QualityCheckId, status: "Cancelled" }); setViewingId(null); }}
                      className="flex-1 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors inline-flex items-center justify-center gap-1.5">
                      <Ban size={13} /> Cancel Follow-Up
                    </button>
                  </div>
                )}
                {rights.canCreate && (
                  <button onClick={() => goToFollowUp(viewDetail)}
                    className="w-full h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors inline-flex items-center justify-center gap-1.5">
                    <CalendarPlus size={13} /> Generate Follow-Up for this FA Item Code
                  </button>
                )}
              </div>
            )}
          </div>
        </div>, document.body,
      )}

      {/* ── Delete confirm ── */}
      {deleteId != null && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDeleteId(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400"><AlertTriangle size={16} /></span>
              <p className="font-semibold text-sm">Delete this quality check?</p>
            </div>
            <p className="text-xs text-muted-foreground">The record is removed from the active list but kept in history for audit. Any pending reminder for it stops.</p>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setDeleteId(null)} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}
                className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
                <Trash2 size={13} /> {deleteMut.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>, document.body,
      )}

      {/* ── Image lightbox ── */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8" onClick={() => setLightbox(null)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <button type="button" onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white z-10"><X size={18} /></button>
          <figure className="relative max-w-full max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.label} className="max-w-full max-h-[82vh] rounded-lg object-contain shadow-2xl" />
            <figcaption className="text-xs text-white/80">{lightbox.label}</figcaption>
          </figure>
        </div>, document.body,
      )}
    </GlassShell>
    </>
  );
}
