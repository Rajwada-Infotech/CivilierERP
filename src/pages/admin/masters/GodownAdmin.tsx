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
import { AdminShell } from "@/components/admin/AdminShell";
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
      tint: "bg-primary/10 text-primary",
    },
    {
      label: "Active",
      value: activeCount,
      icon: CheckCircle2,
      tint: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "Project Defaults",
      value: projectDefaultCount,
      icon: Star,
      tint: "bg-amber-500/10 text-amber-600",
    },
    {
      label: "Companies",
      value: companyCount,
      icon: Building2,
      tint: "bg-blue-500/10 text-blue-600",
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

      <AdminShell
        title="Godowns"
        subtitle="Manage warehouse and storage locations across companies and projects"
        icon={Warehouse}
        action={
          rights.canCreate && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Godown
            </button>
          )
        }
      >
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("p-2.5 rounded-xl shrink-0", s.tint)}>
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-none">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {s.label}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Listing card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">All Godowns</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-muted/40">
                  {TYPE_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setTypeFilter(f.key)}
                      className={cn(
                        "px-2.5 py-1.5 text-xs rounded-md transition-colors",
                        typeFilter === f.key
                          ? "bg-card shadow-sm text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search name, code, location…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-9 w-64"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => refetch()}
                  title="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                Loading godowns…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Warehouse className="h-8 w-8 opacity-30" />
                <span className="text-sm">
                  {search || typeFilter !== "all"
                    ? "No godowns match your filters"
                    : "No godowns configured yet"}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((g) => (
                  <Card
                    key={g.GodownID}
                    className="overflow-hidden flex flex-col"
                  >
                    <div
                      className={cn(
                        "h-1 w-full shrink-0",
                        g.IsProjectDefault ? "bg-primary" : "bg-border",
                      )}
                    />
                    <CardContent className="p-4 flex flex-col gap-3 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {g.IsProjectDefault && (
                            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {g.GodownName}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {g.GodownCode ?? "—"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={g.IsActive ? "default" : "secondary"}
                          className="text-[10px] shrink-0"
                        >
                          {g.IsActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          variant={g.IsProjectDefault ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {g.IsProjectDefault ? "Project Default" : "Storage"}
                        </Badge>
                        {g.EnterpriseName && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] text-muted-foreground">
                            <Building2 className="h-3 w-3" /> {g.EnterpriseName}
                          </span>
                        )}
                        {g.ProjectName && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] text-muted-foreground">
                            <FolderKanban className="h-3 w-3" /> {g.ProjectName}
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">
                          {g.Location || "No location set"}
                        </span>
                      </div>

                      {g.ShortDesc && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {g.ShortDesc}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-3 mt-auto border-t border-border">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={g.IsActive}
                            onCheckedChange={(val) =>
                              toggleMutation.mutate({ g, active: val })
                            }
                            disabled={
                              g.IsProjectDefault || toggleMutation.isPending
                            }
                            title={
                              g.IsProjectDefault
                                ? "This project's default godown cannot be deactivated"
                                : ""
                            }
                          />
                          <span className="text-[11px] text-muted-foreground">
                            {g.IsActive ? "Live" : "Paused"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {rights.canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEdit(g)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {rights.canDelete && !g.IsProjectDefault && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(g)}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </AdminShell>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Godown" : "Add Godown"}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing
                ? "Edit the details of this godown."
                : "Fill in the details to add a new godown."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gd-code">Code</Label>
                <Input
                  id="gd-code"
                  placeholder="e.g. GDN-01"
                  value={form.GodownCode}
                  onChange={(e) => setField("GodownCode", e.target.value)}
                  maxLength={50}
                  className="font-mono uppercase"
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

            <div className="grid grid-cols-2 gap-3">
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
                  className="text-[11px] font-medium text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:no-underline"
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
                <p className="text-[11px] text-muted-foreground">
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
              />
              <Label htmlFor="gd-active" className="cursor-pointer">
                Active
              </Label>
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {isSaving ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete godown?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.GodownName}</strong> will be soft-deleted
              and removed from all dropdown lists. Stock transfer records that
              reference this godown are preserved. This cannot be undone from
              the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
