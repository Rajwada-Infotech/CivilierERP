import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Search, Building2, Package, Calendar, FileText, Hash,
  Check, X, Boxes, User, ChevronsUpDown, Loader2, ImagePlus, UserRound,
} from "lucide-react";
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
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getTransferUsers, type TransferUser } from "@/api/assetTransferApi";
import {
  getAssignableAssets, getAssignments, createAssignment,
  type AssignableAsset, type AssignmentListItem,
} from "@/api/fixedAssetAssignmentApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const inputCls   = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow";
const labelCls   = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";

const avatarColors = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-indigo-500",
];
function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function UserAvatar({ id, name, avatarUrl, size = 24 }: { id: number; name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 ${avatarColors[id % avatarColors.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {getInitials(name) || "?"}
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

function FAItemCodeCombobox({
  assets, value, onSelect, loading, disabled,
}: {
  assets: AssignableAsset[];
  value: string;
  onSelect: (asset: AssignableAsset) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = assets.find((a) => String(a.AssetId) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground")}
        >
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
                    <CommandItem
                      key={a.AssetId}
                      value={`${a.FAItemCode} ${a.AssetName}`}
                      onSelect={() => { onSelect(a); setOpen(false); }}
                      className="data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50"
                    >
                      <Check className={cn("mr-2 h-4 w-4", String(a.AssetId) === value ? "opacity-100" : "opacity-0")} />
                      <span className="flex flex-col min-w-0">
                        <span className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400 truncate">{a.FAItemCode}</span>
                        <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                        <span className="text-[11px] text-muted-foreground truncate">{a.CurrentCustodianName ? `Currently with ${a.CurrentCustodianName}` : "Not yet assigned"}</span>
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

interface FormState {
  docDate: string;
  companyId: string;
  projectId: string;
  finYear: string;
  assetId: string;
  userId: string;
  remarks: string;
}

const emptyForm = (finYear = ""): FormState => ({
  docDate:   new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  finYear,
  assetId:   "",
  userId:    "",
  remarks:   "",
});

type ViewMode = "list" | "form";

export default function FixedAssetAssignment() {
  const rights = usePageRights("fixed-asset-assignment");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm(activeFinYear));
  const [userImage, setUserImage] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data queries ──────────────────────────────────────────────────────────
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["fixed-asset-assignments"],
    queryFn:  () => getAssignments(),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn:  () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn:  () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: users = [] } = useQuery({
    queryKey: ["asset-transfer-users"],
    queryFn:  getTransferUsers,
  });
  const { data: assignableAssets = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["fixed-asset-assignable-assets"],
    queryFn:  getAssignableAssets,
    enabled:  viewMode === "form",
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  // Scoped to the selected company/project once chosen, otherwise every
  // eligible asset — mirrors Asset Transfer's cascading picker.
  const scopedAssets = useMemo(() => {
    let r = ensureArray<AssignableAsset>(assignableAssets);
    if (form.companyId) r = r.filter((a) => String(a.CompanyId) === form.companyId);
    if (form.projectId) r = r.filter((a) => String(a.ProjectId) === form.projectId);
    return r;
  }, [assignableAssets, form.companyId, form.projectId]);

  const selectedAsset = scopedAssets.find((a) => String(a.AssetId) === form.assetId) || null;
  const selectedUser = ensureArray<TransferUser>(users).find((u) => String(u.id) === form.userId) || null;

  const filtered = useMemo(() => {
    let r = ensureArray<AssignmentListItem>(assignments);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((a) =>
        (a.DocNo || "").toLowerCase().includes(s) ||
        (a.AssetName || "").toLowerCase().includes(s) ||
        (a.FAItemCode || "").toLowerCase().includes(s) ||
        (a.UserName || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [assignments, search]);

  const stats = useMemo(() => ({
    count: assignments.length,
    currentlyAssigned: new Set(assignments.filter((a) => a.IsCurrent).map((a) => a.AssetId)).size,
  }), [assignments]);

  // ── image upload ──────────────────────────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 400 * 1024) return toast.error("Image must be under 400 KB");
    const reader = new FileReader();
    reader.onload = () => setUserImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createAssignment,
    onSuccess: (r) => {
      toast.success(`Assigned — ${r.docNo}`);
      qc.invalidateQueries({ queryKey: ["fixed-asset-assignments"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-assignable-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => { setForm(emptyForm(activeFinYear)); setUserImage(null); };
  const goToCreate = () => { resetForm(); setViewMode("form"); };

  const handleSave = () => {
    if (!form.companyId) return toast.error("Company is required");
    if (!form.projectId) return toast.error("Project is required");
    if (!form.finYear)   return toast.error("Financial year is required");
    if (!form.docDate)   return toast.error("Assignment date is required");
    if (!form.assetId)   return toast.error("FA Item Code is required");
    if (!selectedAsset)  return toast.error("Selected FA Item Code is no longer available");
    if (!form.userId)    return toast.error("User is required");

    createMut.mutate({
      docDate:   form.docDate,
      companyId: Number(form.companyId),
      projectId: Number(form.projectId),
      finYear:   form.finYear,
      assetId:   Number(form.assetId),
      userId:    Number(form.userId),
      userImage: userImage || undefined,
      remarks:   form.remarks || undefined,
    });
  };

  const saving = createMut.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title="New Assignment"
        subtitle="Assign a Fixed Asset Depreciation Tag to a user"
        icon={UserRound}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Check size={13} /> {saving ? "Saving…" : "Save Assignment"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 xl:gap-8 items-start w-full max-w-[1400px]">
        <div className="space-y-5 min-w-0">
          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Building2 size={11} /> Company *</label>
                <select value={form.companyId}
                  onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "", assetId: "" }))}
                  className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project *</label>
                <select value={form.projectId}
                  onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, assetId: "" }))}
                  className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Assignment Date *</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Financial Year *</label>
                <select value={form.finYear} onChange={(e) => setField("finYear", e.target.value)} className={inputCls}>
                  <option value="">Select year…</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={Package}>Asset &amp; User</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
              <div className="sm:col-span-2">
                <label className={labelCls}><Hash size={11} /> FA Item Code *</label>
                <FAItemCodeCombobox
                  assets={scopedAssets}
                  value={form.assetId}
                  loading={loadingAssets}
                  onSelect={(asset) => setField("assetId", String(asset.AssetId))}
                />
                {!loadingAssets && scopedAssets.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
                    No Fixed Asset Records found{form.companyId ? " for the selected company/project" : ""}. Create one in Fixed Asset Depreciation Tag first.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}><User size={11} /> User *</label>
                <select value={form.userId} onChange={(e) => setField("userId", e.target.value)} className={inputCls}>
                  <option value="">Select user…</option>
                  {ensureArray<TransferUser>(users).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {selectedUser && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <UserAvatar id={selectedUser.id} name={selectedUser.name} avatarUrl={selectedUser.avatar_url} size={20} />
                    <span className="text-sm font-medium truncate">{selectedUser.name}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={ImagePlus}>User Image</SectionHeader>
            <div className="flex items-center gap-4">
              {userImage ? (
                <img src={userImage} alt="User" className="h-20 w-20 rounded-lg object-cover border border-border shrink-0" />
              ) : (
                <div className="h-20 w-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                  <UserRound size={24} />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all cursor-pointer">
                  <ImagePlus size={13} /> {userImage ? "Change Image" : "Upload Image"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </label>
                {userImage && (
                  <button type="button" onClick={() => setUserImage(null)}
                    className="block text-xs text-muted-foreground hover:text-destructive transition-colors">
                    Remove image
                  </button>
                )}
                <p className="text-[11px] text-muted-foreground">Optional — JPEG/PNG/WebP, under 400 KB.</p>
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Remarks</SectionHeader>
            <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)}
              placeholder="Optional remarks…" className={inputCls} />
          </div>
        </div>

        {/* ── preview ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden h-fit shadow-lg shadow-black/5 dark:shadow-black/20">
          <div className="bg-gradient-to-br from-yellow-500 via-amber-500 to-yellow-700 p-4 text-white">
            <p className="text-[10px] uppercase tracking-wide text-white/70 mb-1.5">Draft Assignment</p>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 shrink-0">
                <UserRound size={16} />
              </span>
              <p className="text-sm font-bold truncate">{selectedAsset?.AssetName || "New Assignment"}</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {userImage && <img src={userImage} alt="User" className="w-full h-32 rounded-lg object-cover" />}
            {selectedUser && (
              <div className="flex items-center gap-2">
                <UserAvatar id={selectedUser.id} name={selectedUser.name} avatarUrl={selectedUser.avatar_url} size={28} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{selectedUser.name}</p>
                  <p className="text-[11px] text-muted-foreground">Assigned To</p>
                </div>
              </div>
            )}
            <div className="space-y-2 text-xs pt-1 border-t border-border">
              {[
                ["FA Item Code", selectedAsset?.FAItemCode || "—"],
                ["Assignment Date", form.docDate ? fmtDate(form.docDate) : "—"],
                ["Remarks", form.remarks || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Assignment"]} />
    <GlassShell
      title="Assignment"
      subtitle="Assign Fixed Asset Depreciation Tags to users, project-wise"
      icon={UserRound}
      accentColor="#eab308"
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Assignment
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total Assignments" value={fmt(stats.count)} icon={Boxes} />
        <SummaryCard label="Assets Currently Assigned" value={fmt(stats.currentlyAssigned)} color="text-emerald-600 dark:text-emerald-400" icon={UserRound} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4">
          <label className={labelCls}>Search</label>
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search doc no, asset, FA Item Code, user…"
              className={`${inputCls} pl-8`} />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Assignment History</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Full audit trail of asset assignments</p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                <UserRound size={26} className="opacity-40" />
              </span>
              <p className="text-sm">No assignments found</p>
              {rights.canCreate && (
                <button onClick={goToCreate}
                  className="mt-2 inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                  <Plus size={13} /> Add First Assignment
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Doc No</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Asset</th>
                    <th className="px-4 py-3 text-left">FA Item Code</th>
                    <th className="px-4 py-3 text-left">Assigned To</th>
                    <th className="px-4 py-3 text-left">Company / Project</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((a) => (
                    <tr key={a.AssignmentId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{a.DocNo || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.DocDate)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate">{a.AssetName || "—"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">{a.AssetCode || "—"}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-yellow-600 dark:text-yellow-400">{a.FAItemCode || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <UserAvatar id={a.UserId} name={a.UserName || "?"} avatarUrl={a.UserAvatar} size={18} />
                          <span className="font-medium">{a.UserName || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.CompanyName || "—"}{a.ProjectName ? ` / ${a.ProjectName}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        {a.IsCurrent ? (
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Current
                          </span>
                        ) : (
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            Superseded
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{a.Remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </GlassShell>
    </>
  );
}
