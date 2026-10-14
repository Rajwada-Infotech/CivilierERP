import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle2, X, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const FIELD = "w-full px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  getMenuMasters,
  addMenuMaster,
  updateMenuMaster,
  deleteMenuMaster,
  type MenuMaster,
} from "@/api/menuMasterApi";
import { usePageRights } from "@/hooks/usePageRights";

// ── Component ─────────────────────────────────────────────────────────────────

const MenuMasterPage: React.FC = () => {
  const rights = usePageRights("menu-master");
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: menus = [], isLoading, error } = useQuery({
    queryKey: ["menuMaster"],
    queryFn: getMenuMasters,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: addMenuMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuMaster"] });
      toast.success("Menu entry created successfully!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { Name: string; Description?: string } }) =>
      updateMenuMaster(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuMaster"] });
      toast.success("Menu entry updated successfully!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMenuMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuMaster"] });
      toast.success("Menu entry deleted.");
      setDeleteId(null);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function openCreate() {
    setEditingId(null);
    setName("");
    setDescription("");
    setDialogOpen(true);
  }

  function openEdit(row: MenuMaster) {
    setEditingId(row.Id);
    setName(row.Name);
    setDescription(row.Description || "");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setName("");
    setDescription("");
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required.");
      return;
    }
    const payload = { Name: trimmedName, Description: description.trim() || undefined };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  const filtered = menus.filter(
    (m) =>
      m.Name.toLowerCase().includes(search.toLowerCase()) ||
      (m.Description || "").toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
        <div className="animate-spin h-7 w-7 border-2 border-foreground border-t-transparent rounded-full mb-4" />
        <p className="text-sm">Loading menu types…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-destructive bg-card border border-destructive mt-8">
        <h2 className="font-heading font-bold mb-2">Could not load the menu types</h2>
        <p className="text-sm">{(error as Error).message}</p>
        <button
          onClick={() => window.location.reload()}
          className={`${KEY_LINE} mt-4 h-9 px-4`}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Setup", "Menu Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Setup"
        title="Menu types"
        subtitle="The kinds of entry a document can be — they fill the Entry Type dropdowns."
        action={
          rights.canCreate && (
            <button type="button" onClick={openCreate} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> New menu entry
            </button>
          )
        }
      >
      {/* Table */}
      <div className="bg-card overflow-hidden" style={{ border: RULE }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
          <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
            Entries <span className="font-normal text-muted-foreground tabular-nums ml-1">{menus.length}</span>
          </span>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search menus…"
              aria-label="Search menus"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${FIELD} h-9 pl-8`}
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className={`${LBL} hover:bg-transparent`} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
              <TableHead className="w-10 text-center h-9 text-inherit">#</TableHead>
              <TableHead className="h-9 text-inherit">Name</TableHead>
              <TableHead className="h-9 text-inherit">Description</TableHead>
              <TableHead className="text-right w-24 h-9 text-inherit">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-16 text-muted-foreground">
                  <p className="text-sm">
                    {search ? "No results match your search." : "No menu entries yet."}
                  </p>
                  {!search && (
                    <p className="text-xs mt-1 opacity-70">
                      Create entries here — they will appear in Entry Type dropdowns.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, idx) => (
                <TableRow key={row.Id} className="hover:bg-primary/5 transition-colors border-foreground/10">
                  <TableCell className="text-center text-muted-foreground text-xs font-heading tabular-nums">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium text-sm">{row.Name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.Description || <span className="opacity-40">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {rights.canEdit && (
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className={`${ACT} hover:text-foreground hover:border-foreground`}
                          title="Edit"
                          aria-label={`Edit ${row.Name}`}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {rights.canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleteId(row.Id)}
                          className={`${ACT} hover:text-destructive hover:border-destructive`}
                          title="Delete"
                          aria-label={`Delete ${row.Name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </SheetShell>

      {/* Create / Edit Dialog */}
      {(rights.canCreate || rights.canEdit) && <Dialog open={dialogOpen} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sheet-frame max-w-sm" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Menu type</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
                {editingId !== null ? "Edit menu entry" : "New menu entry"}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label htmlFor="menu-name" className={`${LBL} block`}>
                Name <span className="text-destructive">*</span>
              </label>
              <input
                id="menu-name"
                placeholder="e.g. Received Payment, Site Expense, Invoice..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
                className={`${FIELD} h-9`}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="menu-description" className={`${LBL} block`}>Description</label>
              <textarea
                id="menu-description"
                placeholder="Optional — describe what this menu type represents"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                className={`${FIELD} py-2 resize-none`}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button type="button" onClick={closeDialog} disabled={isPending} className={`${KEY_LINE} h-9 px-4`}>
              <X size={12} /> Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={isPending || !name.trim()} className={`${KEY_INK} h-9 px-5`}>
              <CheckCircle2 size={12} />
              {isPending ? "Saving…" : editingId !== null ? "Update" : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>}

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Menu type</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete menu entry</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              This will permanently remove this menu entry. It will no longer
              appear in Entry Type dropdowns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel className={`${KEY} h-9 px-4 rounded-none border border-foreground text-foreground bg-card hover:bg-primary/10`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${KEY} h-9 px-5 rounded-none !bg-destructive !text-destructive-foreground border border-destructive hover:!bg-destructive/90`}
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MenuMasterPage;
