import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGodowns,
  createGodown,
  updateGodown,
  deleteGodown,
  type Godown,
  type CreateGodownPayload,
} from "@/api/godownsApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getCompanyLocations,
  formatCompanyLocation,
} from "@/api/companyMasterApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Warehouse,
  Star,
  MapPin,
  Building2,
  FolderKanban,
  CheckCircle2,
} from "lucide-react";

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  GodownCode: string;
  GodownName: string;
  ShortDesc: string;
  Description: string;
  Remarks: string;
  EnterpriseID: number | null;
  ProjectID: number | null;
  Location: string;
  // True while Location still mirrors the selected company's address —
  // flips to false the moment the person edits it by hand, so we never
  // clobber a deliberate override.
  LocationAuto: boolean;
  IsActive: boolean;
}

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 whitespace-nowrap";

const EMPTY_FORM: FormState = {
  GodownCode: "",
  GodownName: "",
  ShortDesc: "",
  Description: "",
  Remarks: "",
  EnterpriseID: null,
  ProjectID: null,
  Location: "",
  LocationAuto: false,
  IsActive: true,
};

function godownToForm(g: Godown): FormState {
  return {
    GodownCode: g.GodownCode ?? "",
    GodownName: g.GodownName,
    ShortDesc: g.ShortDesc ?? "",
    Description: g.Description ?? "",
    Remarks: g.Remarks ?? "",
    EnterpriseID: g.EnterpriseID ?? null,
    ProjectID: g.ProjectID ?? null,
    Location: g.Location ?? "",
    LocationAuto: false,
    IsActive: g.IsActive,
  };
}

// ─── Type filter ──────────────────────────────────────────────────────────────
type TypeFilter = "all" | "default" | "storage";
const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "default", label: "Project Default" },
  { key: "storage", label: "Storage" },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function GodownAdmin() {
  const qc = useQueryClient();
  const rights = usePageRights("godown-master");

  // ── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Godown | null>(null);
  const [editing, setEditing] = useState<Godown | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const {
    data: raw,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
  });

  const godowns: Godown[] = raw?.data ?? [];

  const { data: companies = [] } = useQuery({
    queryKey: ["company-locations"],
    queryFn: getCompanyLocations,
    staleTime: 5 * 60 * 1000,
  });
  const activeCompanies = useMemo(
    () => companies.filter((c) => c.IsActive !== 0 && c.IsActive !== false),
    [companies],
  );

  const { data: projectOptions = [] } = useQuery({
    queryKey: ["enterprise-options", "P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 5 * 60 * 1000,
  });
  const filteredProjects = form.EnterpriseID
    ? projectOptions.filter(
        (p) => String(p.company_id) === String(form.EnterpriseID),
      )
    : projectOptions;

  // ── Derived lists ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return godowns.filter((g) => {
      if (typeFilter === "default" && !g.IsProjectDefault) return false;
      if (typeFilter === "storage" && g.IsProjectDefault) return false;
      if (!q) return true;
      return (
        g.GodownName.toLowerCase().includes(q) ||
        (g.GodownCode ?? "").toLowerCase().includes(q) ||
        (g.Location ?? "").toLowerCase().includes(q) ||
        (g.EnterpriseName ?? "").toLowerCase().includes(q) ||
        (g.ProjectName ?? "").toLowerCase().includes(q)
      );
    });
  }, [godowns, search, typeFilter]);

  const activeCount = godowns.filter((g) => g.IsActive && !g.IsDeleted).length;
  const projectDefaultCount = godowns.filter((g) => g.IsProjectDefault).length;
  const companyCount = useMemo(
    () =>
      new Set(
        godowns
          .filter((g) => g.EnterpriseID != null)
          .map((g) => g.EnterpriseID),
      ).size,
    [godowns],
  );

  const stats = [
    {
      label: "Total Godowns",
      value: godowns.length,
      icon: Warehouse,
      note: "in all",
    },
    {
      label: "Active",
      value: activeCount,
      icon: CheckCircle2,
      note: "live for stock movement",
    },
    {
      label: "Project Defaults",
      value: projectDefaultCount,
      icon: Star,
      note: "one per project, cannot be paused",
    },
    {
      label: "Companies",
      value: companyCount,
      icon: Building2,
      note: "with a godown",
    },
  ];

  // ── Invalidate ─────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["godowns"] });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: CreateGodownPayload) => createGodown(payload),
    onSuccess: (res) => {
      toast.success(res.message || "Godown created");
      invalidate();
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<CreateGodownPayload>;
    }) => updateGodown(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "Godown updated");
      invalidate();
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGodown(id),
    onSuccess: (res) => {
      toast.success(res.message || "Godown deleted");
      invalidate();
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ g, active }: { g: Godown; active: boolean }) =>
      updateGodown(g.GodownID, { IsActive: active }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.active
          ? `"${vars.g.GodownName}" activated`
          : `"${vars.g.GodownName}" deactivated`,
      );
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Location helpers ───────────────────────────────────────────────────────
  function locationForCompany(id: number | null): string {
    const c = companies.find((co) => co.Id === id);
    return c ? formatCompanyLocation(c) : "";
  }

  function handleCompanyChange(value: string) {
    const id = value === "none" ? null : Number(value);
    setForm((f) => {
      const shouldAutoFill = f.LocationAuto || !f.Location.trim();
      const derived = locationForCompany(id);
      return {
        ...f,
        EnterpriseID: id,
        ProjectID: null,
        Location: shouldAutoFill ? derived : f.Location,
        LocationAuto: shouldAutoFill ? true : f.LocationAuto,
      };
    });
  }

  function handleUseCompanyLocation() {
    setForm((f) => ({
      ...f,
      Location: locationForCompany(f.EnterpriseID),
      LocationAuto: true,
    }));
  }

  // ── Dialog helpers ─────────────────────────────────────────────────────────
  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(g: Godown) {
    setEditing(g);
    setForm(godownToForm(g));
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function handleSubmit() {
    const name = form.GodownName.trim();
    if (!name) return setFormError("Godown name is required");
    setFormError(null);

    const payload: CreateGodownPayload = {
      GodownCode: form.GodownCode.trim() || undefined,
      GodownName: name,
      ShortDesc: form.ShortDesc.trim() || undefined,
      Description: form.Description.trim() || undefined,
      Remarks: form.Remarks.trim() || undefined,
      EnterpriseID: form.EnterpriseID,
      ProjectID: form.ProjectID,
      Location: form.Location.trim() || undefined,
      IsActive: form.IsActive,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.GodownID, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const selectedCompanyName = companies.find(
    (c) => c.Id === form.EnterpriseID,
  )?.Name;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={[{ label: "Admin" }, { label: "Masters" }, { label: "Godowns" }]}
      />

      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Godowns"
        subtitle="Warehouse and storage locations across companies and projects. Each project keeps one default godown."
        action={
          rights.canCreate && (
            <button onClick={openAdd} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus className="h-3.5 w-3.5" />
              New godown
            </button>
          )
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {stats.map((s) => (
              <div key={s.label}>
                <p className="label">{s.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : s.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5 mr-auto">
              <span className={HEAD}>Godowns</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
            </p>
            <div className="inline-flex items-stretch border border-foreground">
              {TYPE_FILTERS.map((f, i) => (
                <button
                  key={f.key}
                  onClick={() => setTypeFilter(f.key)}
                  aria-pressed={typeFilter === f.key}
                  className={cn(
                    "h-8 px-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors",
                    i > 0 && "border-l border-foreground",
                    typeFilter === f.key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search name, code, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            <button onClick={() => refetch()} title="Refresh" aria-label="Refresh" className={`${ACT} !w-9 !h-9 !border-foreground/40`}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4">
            {isLoading ? (
              <div className="py-16 text-center text-muted-foreground text-sm">Loading godowns…</div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground border border-dashed border-foreground/40">
                {search || typeFilter !== "all" ? "No godowns match your filters." : "No godowns configured yet."}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((g) => (
                  <div
                    key={g.GodownID}
                    className={cn("bg-card flex flex-col border", g.IsActive ? "border-foreground" : "border-dashed border-foreground/50")}
                  >
                    <div className="p-4 flex flex-col gap-3 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn("font-semibold text-sm truncate", g.IsActive ? "text-foreground" : "text-muted-foreground")}>
                            {g.GodownName}
                          </p>
                          <p className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground mt-0.5">
                            {g.GodownCode ?? "—"}
                          </p>
                        </div>
                        {g.IsActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <span className={cn(TAG, g.IsProjectDefault ? "bg-foreground text-card" : "text-foreground border border-foreground/50")}>
                          {g.IsProjectDefault && <Star className="h-2.5 w-2.5 fill-current" />}
                          {g.IsProjectDefault ? "Project default" : "Storage"}
                        </span>
                        {g.EnterpriseName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-foreground/25 text-[0.6875rem] text-muted-foreground">
                            <Building2 className="h-3 w-3" /> {g.EnterpriseName}
                          </span>
                        )}
                        {g.ProjectName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-foreground/25 text-[0.6875rem] text-muted-foreground">
                            <FolderKanban className="h-3 w-3" /> {g.ProjectName}
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{g.Location || "No location set"}</span>
                      </div>

                      {g.ShortDesc && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{g.ShortDesc}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-foreground/25">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={g.IsActive}
                          onCheckedChange={(val) => toggleMutation.mutate({ g, active: val })}
                          disabled={g.IsProjectDefault || toggleMutation.isPending}
                          title={g.IsProjectDefault ? "This project's default godown cannot be deactivated" : ""}
                          className="data-[state=checked]:bg-foreground"
                        />
                        <span className={LBL}>{g.IsActive ? "Live" : "Paused"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {rights.canEdit && (
                          <button onClick={() => openEdit(g)} title="Edit" aria-label="Edit" className={ACT}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {rights.canDelete && !g.IsProjectDefault && (
                          <button
                            onClick={() => setDeleteTarget(g)}
                            title="Delete"
                            aria-label="Delete"
                            className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetShell>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sheet-frame sm:max-w-lg" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Godown</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{editing ? "Edit godown" : "New godown"}</DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              {editing
                ? "Edit the details of this godown."
                : "Fill in the details to add a new godown."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gd-code">Code</Label>
                <Input
                  id="gd-code"
                  placeholder="e.g. GDN-01"
                  value={form.GodownCode}
                  onChange={(e) => setField("GodownCode", e.target.value)}
                  maxLength={50}
                  className="font-heading tabular-nums uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gd-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="gd-name"
                  placeholder="e.g. Main Warehouse"
                  value={form.GodownName}
                  onChange={(e) => setField("GodownName", e.target.value)}
                  maxLength={255}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gd-company">Company</Label>
                <Select
                  value={
                    form.EnterpriseID != null
                      ? String(form.EnterpriseID)
                      : "none"
                  }
                  onValueChange={handleCompanyChange}
                >
                  <SelectTrigger id="gd-company" className="h-9">
                    <SelectValue placeholder="No company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {activeCompanies.map((c) => (
                      <SelectItem key={c.Id} value={String(c.Id)}>
                        {c.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gd-project">Project</Label>
                <Select
                  value={
                    form.ProjectID != null ? String(form.ProjectID) : "none"
                  }
                  onValueChange={(v) =>
                    setField("ProjectID", v === "none" ? null : Number(v))
                  }
                >
                  <SelectTrigger id="gd-project" className="h-9">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {filteredProjects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="gd-location">Location</Label>
                <button
                  type="button"
                  onClick={handleUseCompanyLocation}
                  disabled={!form.EnterpriseID}
                  className="text-[0.6875rem] font-medium text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Use company location
                </button>
              </div>
              <Input
                id="gd-location"
                placeholder={
                  form.EnterpriseID
                    ? "Fetched from company — edit if needed"
                    : "e.g. Plot 12, Industrial Area"
                }
                value={form.Location}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    Location: e.target.value,
                    LocationAuto: false,
                  }))
                }
                maxLength={255}
              />
              {form.LocationAuto && selectedCompanyName && (
                <p className="text-[0.6875rem] text-muted-foreground">
                  Synced with {selectedCompanyName}'s address.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gd-short">Short Description</Label>
              <Input
                id="gd-short"
                placeholder="Brief label (max 100 chars)"
                value={form.ShortDesc}
                onChange={(e) => setField("ShortDesc", e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gd-desc">Description</Label>
              <Textarea
                id="gd-desc"
                placeholder="Optional detailed description"
                value={form.Description}
                onChange={(e) => setField("Description", e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gd-remarks">Remarks</Label>
              <Input
                id="gd-remarks"
                placeholder="Internal notes"
                value={form.Remarks}
                onChange={(e) => setField("Remarks", e.target.value)}
                maxLength={500}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="gd-active"
                checked={form.IsActive}
                onCheckedChange={(val) => setField("IsActive", val)}
                className="data-[state=checked]:bg-foreground"
              />
              <Label htmlFor="gd-active" className="cursor-pointer">
                Active
              </Label>
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter className="pt-3 gap-2" style={{ borderTop: RULE }}>
            <button onClick={closeDialog} disabled={isSaving} className={`${KEY_LINE} h-9 px-4`}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={isSaving} className={`${KEY_INK} h-9 px-5`}>
              {isSaving ? "Saving…" : editing ? "Update" : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Godown</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete godown</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              <strong>{deleteTarget?.GodownName}</strong> will be soft-deleted
              and removed from all dropdown lists. Stock transfer records that
              reference this godown are preserved. This cannot be undone from
              the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel className={`${KEY_LINE} h-9 px-4 rounded-none`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${KEY} h-9 px-5 rounded-none !bg-destructive !text-destructive-foreground border border-destructive hover:!bg-destructive/90`}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.GodownID)
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
