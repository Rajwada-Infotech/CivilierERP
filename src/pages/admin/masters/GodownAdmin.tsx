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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Warehouse,
  Star,
  MapPin,
} from "lucide-react";

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  GodownCode: string;
  GodownName: string;
  ShortDesc: string;
  Description: string;
  Remarks: string;
  Location: string;
  IsActive: boolean;
}

const EMPTY_FORM: FormState = {
  GodownCode: "",
  GodownName: "",
  ShortDesc: "",
  Description: "",
  Remarks: "",
  Location: "",
  IsActive: true,
};

function godownToForm(g: Godown): FormState {
  return {
    GodownCode: g.GodownCode ?? "",
    GodownName: g.GodownName,
    ShortDesc: g.ShortDesc ?? "",
    Description: g.Description ?? "",
    Remarks: g.Remarks ?? "",
    Location: g.Location ?? "",
    IsActive: g.IsActive,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GodownAdmin() {
  const qc = useQueryClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Godown | null>(null);
  const [editing, setEditing] = useState<Godown | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: raw, isLoading, refetch } = useQuery({
    queryKey: ["godowns-admin"],
    queryFn: getGodowns,
  });

  const godowns: Godown[] = raw?.data ?? [];

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return godowns;
    return godowns.filter(
      (g) =>
        g.GodownName.toLowerCase().includes(q) ||
        (g.GodownCode ?? "").toLowerCase().includes(q) ||
        (g.Location ?? "").toLowerCase().includes(q),
    );
  }, [godowns, search]);

  const activeCount = godowns.filter((g) => g.IsActive && !g.IsDeleted).length;

  // ── Invalidate ─────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["godowns-admin"] });

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Warehouse className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Godowns</h1>
            <p className="text-sm text-muted-foreground">
              Manage warehouse and storage locations
            </p>
          </div>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Godown
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: godowns.length },
          { label: "Active", value: activeCount },
          {
            label: "Main Godown",
            value: godowns.filter((g) => g.IsMain).length,
          },
        ].map((s) => (
          <Card key={s.label} className="py-3">
            <CardContent className="p-0 px-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-2xl font-bold">{s.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">All Godowns</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, code or location…"
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
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Loading godowns…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Warehouse className="h-8 w-8 opacity-30" />
              <span className="text-sm">
                {search
                  ? "No godowns match your search"
                  : "No godowns configured yet"}
              </span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-24 text-center">Type</TableHead>
                  <TableHead className="w-24 text-center">Status</TableHead>
                  <TableHead className="w-20 text-center">Active</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((g) => (
                  <TableRow key={g.GodownID}>
                    <TableCell className="font-mono text-xs font-medium">
                      {g.GodownCode ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {g.IsMain && (
                          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                        )}
                        {g.GodownName}
                      </div>
                      {g.ShortDesc && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {g.ShortDesc}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {g.Location ? (
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          {g.Location}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {g.IsMain ? (
                        <Badge variant="default" className="text-xs">
                          Main
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Branch
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={g.IsActive ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {g.IsActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={g.IsActive}
                        onCheckedChange={(val) =>
                          toggleMutation.mutate({ g, active: val })
                        }
                        disabled={g.IsMain || toggleMutation.isPending}
                        title={
                          g.IsMain ? "Main godown cannot be deactivated" : ""
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(g)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!g.IsMain && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(g)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Godown" : "Add Godown"}
            </DialogTitle>
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
              <Label htmlFor="gd-location">Location</Label>
              <Input
                id="gd-location"
                placeholder="e.g. Plot 12, Industrial Area"
                value={form.Location}
                onChange={(e) => setField("Location", e.target.value)}
                maxLength={255}
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
            <Button onClick={handleSubmit} disabled={isSaving}>
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
    </div>
  );
}