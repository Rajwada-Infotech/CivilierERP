import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle2, LayoutList, X, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-4" />
        <p>Loading Menu Master...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-red-500 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 mt-8">
        <h2 className="font-semibold mb-2">Failed to Load Data</h2>
        <p>{(error as Error).message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-5 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Setup", "Menu Master"]} />
      <AdminShell
        title="Menu Master"
        icon={LayoutList}
        action={
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search menus..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            {rights.canCreate && (
              <Button onClick={openCreate} size="sm" className="gap-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90">
                <Plus size={15} />
                New Menu Entry
              </Button>
            )}
          </div>
        }
      >
      {/* Table */}
      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-16 text-muted-foreground">
                  <LayoutList size={32} className="mx-auto mb-3 opacity-20" />
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
                <TableRow key={row.Id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-center text-muted-foreground text-xs">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium text-sm">{row.Name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.Description || <span className="opacity-40">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {rights.canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(row)}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil size={13} />
                        </Button>
                      )}
                      {rights.canDelete && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteId(row.Id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </AdminShell>

      {/* Create / Edit Dialog */}
      {(rights.canCreate || rights.canEdit) && <Dialog open={dialogOpen} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <LayoutList size={16} className="text-primary" />
              {editingId !== null ? "Edit Menu Entry" : "New Menu Entry"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-sm">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Received Payment, Site Expense, Invoice..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
                className="text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Textarea
                placeholder="Optional — describe what this menu type represents"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={isPending} size="sm">
              <X size={13} className="mr-1" />
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || !name.trim()} size="sm" className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90">
              <CheckCircle2 size={13} className="mr-1" />
              {isPending ? "Saving..." : editingId !== null ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Menu Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this menu entry. It will no longer
              appear in Entry Type dropdowns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
