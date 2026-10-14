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
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  code: string;
  name: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { code: "", name: "", isActive: true };

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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

      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Contractor categories"
        subtitle="The categories a contractor can be filed under, such as civil or electrical. Inactive ones stay on existing records."
        action={
          rights.canCreate && (
            <button onClick={openAdd} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus className="h-3.5 w-3.5" />
              New category
            </button>
          )
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Categories", value: categories.length, note: "in all" },
              { label: "Active", value: activeCount, note: "offered for contractors" },
              { label: "Inactive", value: categories.length - activeCount, note: "kept on existing records" },
            ].map((s) => (
              <div key={s.label}>
                <p className="label">{s.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : s.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5 mr-auto">
              <span className={HEAD}>Categories</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
            </p>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            <button onClick={() => refetch()} title="Refresh" aria-label="Refresh" className={`${ACT} !w-9 !h-9 !border-foreground/40`}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading categories…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {search ? "No categories match your search." : "No categories yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground))" }}>
                    <th className="px-4 py-2.5 text-left font-semibold w-32">Code</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold w-28">Status</th>
                    <th className="px-4 py-2.5 text-center font-semibold w-24">Live</th>
                    <th className="px-4 py-2.5 text-right font-semibold w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((cat) => (
                    <tr key={cat.id} className="hover:bg-primary/5 transition-colors" style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.12)" }}>
                      <td className={`px-4 py-2.5 font-heading text-xs font-semibold tabular-nums ${cat.isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {cat.code}
                      </td>
                      <td className={`px-4 py-2.5 font-medium ${cat.isActive ? "text-foreground" : "text-muted-foreground"}`}>{cat.name}</td>
                      <td className="px-4 py-2.5">
                        {cat.isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Switch
                          checked={cat.isActive}
                          onCheckedChange={(val) => toggleMutation.mutate({ cat, active: val })}
                          disabled={toggleMutation.isPending}
                          className="data-[state=checked]:bg-foreground"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {rights.canEdit && (
                            <button onClick={() => openEdit(cat)} title="Edit" aria-label="Edit" className={ACT}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button
                              onClick={() => setDeleteTarget(cat)}
                              title="Deactivate"
                              aria-label="Deactivate"
                              className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SheetShell>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sheet-frame sm:max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Contractor category</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
                {editing ? "Edit category" : "New category"}
              </DialogTitle>
            </div>
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
                className="font-heading tabular-nums uppercase"
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
                className="data-[state=checked]:bg-foreground"
              />
              <Label htmlFor="cc-active" className="cursor-pointer">
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

      {/* Delete (deactivate) Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Contractor category</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Deactivate category</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be marked inactive.
              Existing records referencing this category are preserved. You can
              reactivate it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel className={`${KEY_LINE} h-9 px-4 rounded-none`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${KEY} h-9 px-5 rounded-none bg-destructive text-destructive-foreground border border-destructive hover:bg-destructive/90`}
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