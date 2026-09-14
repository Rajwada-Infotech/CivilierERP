import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  LayoutList,
  X,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import {
  getMenuTypes,
  addMenuType,
  updateMenuType,
  deleteMenuType,
  type MenuType,
} from "@/api/menuTypeApi";
import { menuTypeSchema, type MenuTypeForm } from "@/schemas/menuTypeSchema";
import { usePageRights } from "@/hooks/usePageRights";

// ── Constants ─────────────────────────────────────────────────────────────────

const MENU_FIELDS: { key: keyof MenuType; label: string; placeholder: string }[] = [
  { key: "MenuReceipt", label: "Receipt", placeholder: "e.g. Received Payment" },
  { key: "MenuPayment", label: "Payment", placeholder: "e.g. New Payment" },
  { key: "MenuBOQ", label: "BOQ", placeholder: "e.g. Bill of Quantities" },
  { key: "MenuPurchaseOrder", label: "Purchase Order", placeholder: "e.g. Purchase Order" },
  { key: "MenuWorkOrder", label: "Work Order", placeholder: "e.g. Work Order" },
];

const AUDIT_FIELDS: { key: keyof MenuType; label: string }[] = [
  { key: "CreatedBy", label: "Created By" },
  { key: "UpdatedBy", label: "Updated By" },
  { key: "ApprovedBy", label: "Approved By" },
];

const EMPTY_FORM: MenuTypeForm = {
  MenuReceipt: "",
  MenuPayment: "",
  MenuBOQ: "",
  MenuPurchaseOrder: "",
  MenuWorkOrder: "",
  CreatedBy: "",
  UpdatedBy: "",
  ApprovedBy: "",
};

// ── Component ─────────────────────────────────────────────────────────────────

const MenuTypeMaster: React.FC = () => {
  const rights = usePageRights("menu-type");
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { register, handleSubmit, reset } = useForm<MenuTypeForm>({
    resolver: zodResolver(menuTypeSchema),
    defaultValues: EMPTY_FORM,
  });

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: menuTypes = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["menuTypes"],
    queryFn: getMenuTypes,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: addMenuType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuTypes"] });
      toast.success("Menu type created successfully!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      updateMenuType(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuTypes"] });
      toast.success("Menu type updated successfully!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMenuType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menuTypes"] });
      toast.success("Menu type deleted.");
      setDeleteId(null);
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const filledCount = (row: MenuType) =>
    MENU_FIELDS.filter((f) => row[f.key]).length;

  function openCreate() {
    setEditingId(null);
    reset(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(row: MenuType) {
    setEditingId(row.Id);
    reset({
      MenuReceipt: row.MenuReceipt || "",
      MenuPayment: row.MenuPayment || "",
      MenuBOQ: row.MenuBOQ || "",
      MenuPurchaseOrder: row.MenuPurchaseOrder || "",
      MenuWorkOrder: row.MenuWorkOrder || "",
      CreatedBy: row.CreatedBy || "",
      UpdatedBy: row.UpdatedBy || "",
      ApprovedBy: row.ApprovedBy || "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    reset(EMPTY_FORM);
  }

  function submitMenuType(values: MenuTypeForm) {
    const payload = {
      MenuReceipt: values.MenuReceipt || null,
      MenuPayment: values.MenuPayment || null,
      MenuBOQ: values.MenuBOQ || null,
      MenuPurchaseOrder: values.MenuPurchaseOrder || null,
      MenuWorkOrder: values.MenuWorkOrder || null,
      CreatedBy: values.CreatedBy || null,
      UpdatedBy: values.UpdatedBy || null,
      ApprovedBy: values.ApprovedBy || null,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-4" />
        <p>Loading Menu Types...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-red-500 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 mt-8">
        <h2 className="font-semibold mb-2">Failed to Load Data</h2>
        <p>{(error as Error).message || "Unknown error occurred"}</p>
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
      <Breadcrumbs items={["Dashboard", "Admin", "Setup", "Menu Type Master"]} />
      <AdminShell
        title="Menu Type Master"
        subtitle={
          <>
            Configure named menu labels — these populate the{" "}
            <span className="text-foreground font-medium">Entry Type</span> dropdown
            in Named Entry Types.
          </>
        }
        icon={LayoutList}
        action={
          rights.canCreate && (
            <Button onClick={openCreate} size="sm" className="gap-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90">
              <Plus size={15} />
              New Menu Type
            </Button>
          )
        }
      >
      {/* Table */}
      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Receipt</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>BOQ</TableHead>
              <TableHead>Purchase Order</TableHead>
              <TableHead>Work Order</TableHead>
              <TableHead className="text-center w-20">Labels</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead className="text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {menuTypes.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-16 text-muted-foreground"
                >
                  <LayoutList
                    size={32}
                    className="mx-auto mb-3 opacity-20"
                  />
                  <p className="text-sm">No menu types configured yet.</p>
                  <p className="text-xs mt-1 opacity-70">
                    Create one to start populating Entry Type dropdowns.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              menuTypes.map((row, idx) => (
                <TableRow
                  key={row.Id}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <TableCell className="text-center text-muted-foreground text-xs">
                    {idx + 1}
                  </TableCell>
                  {MENU_FIELDS.map((f) => (
                    <TableCell key={f.key} className="text-sm">
                      {row[f.key] || (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        filledCount(row) === 5 ? "default" : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {filledCount(row)}/5
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.CreatedBy || "—"}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <LayoutList size={16} className="text-primary" />
              {editingId !== null ? "Edit Menu Type" : "New Menu Type"}
            </DialogTitle>
          </DialogHeader>

          <form className="space-y-5 py-1" onSubmit={handleSubmit(submitMenuType)}>
            {/* Menu labels */}
            <div className="space-y-1">
              <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground mb-3">
                Menu Labels
              </p>
              <div className="space-y-3">
                {MENU_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="grid grid-cols-[110px_1fr] items-center gap-3"
                  >
                    <Label className="text-right text-sm font-body">
                      {field.label}
                    </Label>
                    <Input
                      placeholder={field.placeholder}
                      {...register(field.key as keyof MenuTypeForm)}
                      maxLength={200}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Audit fields */}
            <div className="border-t pt-4 space-y-1">
              <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground mb-3">
                Audit
              </p>
              <div className="space-y-3">
                {AUDIT_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="grid grid-cols-[110px_1fr] items-center gap-3"
                  >
                    <Label className="text-right text-sm font-body">
                      {field.label}
                    </Label>
                    <Input
                      placeholder="Name"
                      {...register(field.key as keyof MenuTypeForm)}
                      maxLength={100}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={isPending}
                size="sm"
              >
                <X size={13} className="mr-1" />
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} size="sm" className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90">
                <CheckCircle2 size={13} className="mr-1" />
                {isPending ? "Saving..." : editingId !== null ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>

        </DialogContent>
      </Dialog>}

      {/* Delete Confirm */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Menu Type?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this menu type configuration. The
              labels will no longer appear in Entry Type dropdowns.
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

export default MenuTypeMaster;
