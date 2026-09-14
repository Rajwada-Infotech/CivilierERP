import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getContractorCategories,
  addContractorCategory,
  updateContractorCategory,
  deleteContractorCategory,
  type ContractorCategory,
  type ContractorCategoryPayload,
} from "@/api/contractorCategoryApi";
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
import { Plus, Pencil, Trash2, Search, RefreshCw, Tag } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  code: string;
  name: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { code: "", name: "", isActive: true };

// ─── Component ────────────────────────────────────────────────────────────────
export default function ContractorCategoryAdmin() {
  const qc = useQueryClient();
  const rights = usePageRights("contractor-category");

  // ── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContractorCategory | null>(null);
  const [editing, setEditing] = useState<ContractorCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: categories = [], isLoading, refetch } = useQuery({
    queryKey: ["contractor-categories"],
    queryFn: getContractorCategories,
  });

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    );
  }, [categories, search]);

  const activeCount = categories.filter((c) => c.isActive).length;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["contractor-categories"] });

  const createMutation = useMutation({
    mutationFn: (payload: ContractorCategoryPayload) =>
      addContractorCategory(payload),
    onSuccess: (res) => {
      toast.success(res.message || "Category created");
      invalidate();
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ContractorCategoryPayload }) =>
      updateContractorCategory(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "Category updated");
      invalidate();
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteContractorCategory(id),
    onSuccess: (res) => {
      toast.success(res.message || "Category deactivated");
      invalidate();
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ cat, active }: { cat: ContractorCategory; active: boolean }) =>
      updateContractorCategory(cat.id, {
        code: cat.code,
        name: cat.name,
        isActive: active,
      }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.active ? `"${vars.cat.name}" activated` : `"${vars.cat.name}" deactivated`,
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

  function openEdit(cat: ContractorCategory) {
    setEditing(cat);
    setForm({ code: cat.code, name: cat.name, isActive: cat.isActive });
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
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code) return setFormError("Code is required");
    if (!name) return setFormError("Name is required");
    setFormError(null);

    const payload: ContractorCategoryPayload = { code, name, isActive: form.isActive };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={[
        { label: "Admin" },
        { label: "Masters" },
        { label: "Contractor Categories" },
      ]} />

      <AdminShell
        title="Contractor Categories"
        subtitle="Manage contractor category master data"
        icon={Tag}
        action={
          rights.canCreate && (
            <button onClick={openAdd} className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all">
              <Plus className="h-3.5 w-3.5" />
              Add Category
            </button>
          )
        }
      >
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: categories.length },
          { label: "Active", value: activeCount },
          { label: "Inactive", value: categories.length - activeCount },
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
            <CardTitle className="text-base">All Categories</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search code or name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 w-56"
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
              Loading categories…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Tag className="h-8 w-8 opacity-30" />
              <span className="text-sm">
                {search ? "No categories match your search" : "No categories yet"}
              </span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24 text-center">Status</TableHead>
                  <TableHead className="w-20 text-center">Active</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {cat.code}
                    </TableCell>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={cat.isActive ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {cat.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={cat.isActive}
                        onCheckedChange={(val) =>
                          toggleMutation.mutate({ cat, active: val })
                        }
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {rights.canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(cat)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {rights.canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(cat)}
                            title="Deactivate"
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

      </AdminShell>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Category" : "Add Contractor Category"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-code">
                Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cc-code"
                placeholder="e.g. CIVIL"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                maxLength={50}
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cc-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cc-name"
                placeholder="e.g. Civil Contractor"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                maxLength={255}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="cc-active"
                checked={form.isActive}
                onCheckedChange={(val) =>
                  setForm((f) => ({ ...f, isActive: val }))
                }
              />
              <Label htmlFor="cc-active" className="cursor-pointer">
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
            <Button onClick={handleSubmit} disabled={isSaving} className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto hover:opacity-90">
              {isSaving ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete (deactivate) Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate category?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be marked inactive.
              Existing records referencing this category are preserved. You can
              reactivate it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deactivating…" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}