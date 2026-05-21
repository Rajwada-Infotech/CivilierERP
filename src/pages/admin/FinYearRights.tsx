import React, { useCallback, useMemo, useState } from "react";
import { useFinYear, type FinYear } from "@/contexts/FinYearContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Calendar,
  Edit3,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { finYearSchema, type FinYearForm } from "@/schemas/finYearSchema";
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

const EMPTY_FORM: FinYearForm = {
  year: "",
  startDate: "",
  endDate: "",
  status: "Active",
  locked: false,
};

export default function FinYearRights() {
  const {
    finYears,
    isLoading,
    addFinYear,
    updateFinYear,
    toggleLock,
    deleteFinYear,
  } = useFinYear();

  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingFinYear, setEditingFinYear] = useState<FinYear | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FinYearForm>({
    resolver: zodResolver(finYearSchema),
    defaultValues: EMPTY_FORM,
  });
  const formData = watch();

  const filteredFinYears = useMemo(
    () =>
      finYears.filter(
        (fy) =>
          fy.year.toLowerCase().includes(searchTerm.toLowerCase()) ||
          fy.startDate.includes(searchTerm) ||
          fy.endDate.includes(searchTerm),
      ),
    [finYears, searchTerm],
  );

  const activeCount = useMemo(
    () => finYears.filter((fy) => fy.status === "Active").length,
    [finYears],
  );

  const resetForm = useCallback(() => {
    reset(EMPTY_FORM);
    setEditingFinYear(null);
    setShowDialog(false);
  }, [reset]);

  const openAddDialog = useCallback(() => {
    setEditingFinYear(null);
    reset(EMPTY_FORM);
    setShowDialog(true);
  }, [reset]);

  const openEditDialog = useCallback(
    (fy: FinYear) => {
      setEditingFinYear(fy);
      reset({
        year: fy.year,
        startDate: fy.startDate,
        endDate: fy.endDate,
        status: fy.status,
        locked: fy.locked,
      });
      setShowDialog(true);
    },
    [reset],
  );

  const handleSave = useCallback(
    async (values: FinYearForm) => {
      setIsSaving(true);
      try {
        if (editingFinYear) {
          await updateFinYear(editingFinYear.id, {
            year: values.year,
            startDate: values.startDate,
            endDate: values.endDate,
            status: values.status,
            locked: values.locked,
          });
          toast.success(`Financial year "${values.year}" updated`);
        } else {
          await addFinYear({
            year: values.year,
            startDate: values.startDate,
            endDate: values.endDate,
            status: values.status,
            locked: values.locked,
          });
          toast.success(`Financial year "${values.year}" added`);
        }
        resetForm();
      } catch (err: any) {
        toast.error(err?.message || "Save failed");
      } finally {
        setIsSaving(false);
      }
    },
    [addFinYear, editingFinYear, resetForm, updateFinYear],
  );

  const handleToggleLock = useCallback(
    async (id: string, currentlyLocked: boolean) => {
      setPendingLockId(id);
      try {
        const newLockedState = !currentlyLocked;
        await toggleLock(id, newLockedState);
        toast.success(
          newLockedState ? "Financial year locked" : "Financial year unlocked",
        );
      } catch (err: any) {
        toast.error(err?.message || "Failed to change lock status");
      } finally {
        setPendingLockId(null);
      }
    },
    [toggleLock],
  );

  const handleDelete = useCallback(async () => {
    if (!deletingId) return;

    setIsDeleting(true);
    try {
      await deleteFinYear(deletingId);
      toast.success("Financial year deleted");
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    } finally {
      setIsDeleting(false);
      setDeletingId(null);
    }
  }, [deleteFinYear, deletingId]);

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Fin Year Rights"]} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground">
            <Calendar className="h-8 w-8 text-primary" />
            Financial Year Rights
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage financial years, dates, and lock status
          </p>
        </div>

        <Button onClick={openAddDialog} disabled={isLoading}>
          <Plus className="mr-2 h-4 w-4" />
          New Financial Year
        </Button>
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!isSaving) setShowDialog(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFinYear ? "Edit Financial Year" : "New Financial Year"}
            </DialogTitle>
            <DialogDescription>
              Configure financial year details
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4 py-4" onSubmit={handleSubmit(handleSave)}>
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                {...register("year")}
                placeholder="e.g. 2025-26"
              />
              {errors.year && (
                <p className="text-xs text-destructive">
                  {errors.year.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input id="startDate" type="date" {...register("startDate")} />
                {errors.startDate && (
                  <p className="text-xs text-destructive">
                    {errors.startDate.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input id="endDate" type="date" {...register("endDate")} />
                {errors.endDate && (
                  <p className="text-xs text-destructive">
                    {errors.endDate.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setValue("status", value as FinYearForm["status"], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="locked"
                checked={formData.locked}
                onCheckedChange={(checked) => setValue("locked", checked)}
              />
              <Label htmlFor="locked" className="font-normal">
                Locked (Read Only)
              </Label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Financial Years</CardTitle>
            <CardDescription>
              {activeCount} active • {finYears.length} total financial years
            </CardDescription>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search years..."
              className="w-64 pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Locked</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading financial years...
                    </span>
                  </TableCell>
                </TableRow>
              ) : filteredFinYears.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No financial years found. Add one above.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFinYears.map((fy) => {
                  const lockPending = pendingLockId === fy.id;

                  return (
                    <TableRow key={fy.id}>
                      <TableCell className="font-medium">{fy.year}</TableCell>
                      <TableCell>
                        {fy.startDate} - {fy.endDate}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            fy.status === "Active" ? "default" : "secondary"
                          }
                          className={
                            fy.status === "Active"
                              ? "border border-green-500/20 bg-green-500/10 text-green-700"
                              : "border border-red-500/20 bg-red-500/10 text-red-700"
                          }
                        >
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                              fy.status === "Active"
                                ? "bg-green-500"
                                : "bg-red-500"
                            }`}
                          />
                          {fy.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={fy.locked ? "destructive" : "secondary"}
                        >
                          {fy.locked ? "Locked" : "Unlocked"}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => openEditDialog(fy)}
                        >
                          <Edit3 className="mr-1 h-4 w-4" />
                          Edit
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => handleToggleLock(fy.id, fy.locked)}
                          disabled={lockPending}
                        >
                          {lockPending ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : fy.locked ? (
                            <Unlock className="mr-1 h-4 w-4" />
                          ) : (
                            <Lock className="mr-1 h-4 w-4" />
                          )}
                          {fy.locked ? "Unlock" : "Lock"}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:bg-destructive/5"
                          onClick={() => setDeletingId(fy.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Financial Year?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              financial year.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
