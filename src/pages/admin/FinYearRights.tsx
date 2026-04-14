import React, { useState, useMemo, useCallback } from "react";
import { useFinYear, type FinYear } from "@/contexts/FinYearContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Calendar, Plus, Search, Trash2, Edit3, Lock, Unlock } from "lucide-react";
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

export default function FinYearRights() {
  const { finYears, addFinYear, updateFinYear, toggleLock, deleteFinYear } =
    useFinYear();

  const [searchTerm, setSearchTerm] = useState("");
  // FIX: showDialog is now controlled ONLY by state — no DialogTrigger is used.
  // This means Edit button can open the same dialog without the trigger closing it.
  const [showDialog, setShowDialog] = useState(false);
  const [editingFinYear, setEditingFinYear] = useState<FinYear | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    year: "",
    startDate: "",
    endDate: "",
    status: "Active" as "Active" | "Closed",
    locked: false,
  });

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

  // FIX: openAddDialog sets editing to null, clears form, then opens dialog
  const openAddDialog = useCallback(() => {
    setEditingFinYear(null);
    setFormData({
      year: "",
      startDate: "",
      endDate: "",
      status: "Active",
      locked: false,
    });
    setShowDialog(true);
  }, []);

  // FIX: openEditDialog sets the record first, then opens dialog
  // Previously this was fighting with DialogTrigger's own open state
  const openEditDialog = useCallback((fy: FinYear) => {
    setEditingFinYear(fy);
    setFormData({
      year: fy.year,
      startDate: fy.startDate,
      endDate: fy.endDate,
      status: fy.status,
      locked: fy.locked,
    });
    setShowDialog(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formData.year || !formData.startDate || !formData.endDate) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      if (editingFinYear) {
        await updateFinYear(editingFinYear.id, formData);
        toast.success(`Financial year "${formData.year}" updated`);
      } else {
        await addFinYear({
          year: formData.year,
          startDate: formData.startDate,
          endDate: formData.endDate,
          status: formData.status,
          locked: formData.locked,
        });
        toast.success(`Financial year "${formData.year}" added`);
      }
      setShowDialog(false);
    } catch (err: any) {
      toast.error(err?.message || "Save failed");
    }
  }, [formData, editingFinYear, addFinYear, updateFinYear]);

  // FIX: toggleLock sends ONLY FisLocked. The backend PUT was overwriting all
  // fields with null when they weren't provided. The backend route is also fixed
  // (see finYear.js) to do a partial UPDATE only on FisLocked for this action.
  // At the frontend level we call toggleLock (not updateFinYear) so the context
  // sends only { FisLocked } to the backend.
  const handleToggleLock = useCallback(
    async (id: string, currentlyLocked: boolean) => {
      try {
        const newLockedState = !currentlyLocked;
        await toggleLock(id, newLockedState);
        toast.success(
          newLockedState ? "Financial year locked" : "Financial year unlocked",
        );
      } catch {
        toast.error("Failed to change lock status");
      }
    },
    [toggleLock],
  );

  const handleDelete = useCallback(async () => {
    if (deletingId) {
      try {
        await deleteFinYear(deletingId);
        toast.error("Financial year deleted");
      } catch {
        toast.error("Delete failed");
      } finally {
        setDeletingId(null);
      }
    }
  }, [deletingId, deleteFinYear]);

  const resetForm = useCallback(() => {
    setFormData({
      year: "",
      startDate: "",
      endDate: "",
      status: "Active",
      locked: false,
    });
    setEditingFinYear(null);
    setShowDialog(false);
  }, []);

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Fin Year Rights"]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Calendar className="w-8 h-8 text-primary" />
            Financial Year Rights
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage financial years, dates and lock status
          </p>
        </div>

        {/* FIX: Plain Button — no DialogTrigger wrapping — calls openAddDialog */}
        <Button onClick={openAddDialog}>
          <Plus className="w-4 h-4 mr-2" />
          New Financial Year
        </Button>
      </div>

      {/* FIX: Dialog is fully state-controlled via showDialog.
          No DialogTrigger here — both Add and Edit share this single dialog. */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFinYear ? "Edit Financial Year" : "New Financial Year"}
            </DialogTitle>
            <DialogDescription>
              Configure financial year details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                value={formData.year}
                onChange={(e) =>
                  setFormData({ ...formData, year: e.target.value })
                }
                placeholder="e.g. 2025-26"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) =>
                    setFormData({ ...formData, startDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) =>
                    setFormData({ ...formData, endDate: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(val) =>
                  setFormData({
                    ...formData,
                    status: val as "Active" | "Closed",
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
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, locked: checked })
                }
              />
              <Label htmlFor="locked" className="font-normal">
                Locked (Read Only)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Financial Years</CardTitle>
            <CardDescription>
              {activeCount} active · {finYears.length} total financial years
            </CardDescription>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search years..."
              className="pl-10 w-64"
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
              {filteredFinYears.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No financial years found. Add one above.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFinYears.map((fy) => (
                  <TableRow key={fy.id}>
                    <TableCell className="font-medium">{fy.year}</TableCell>
                    <TableCell>
                      {fy.startDate} – {fy.endDate}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fy.status === "Active" ? "default" : "secondary"
                        }
                        className={
                          fy.status === "Active"
                            ? "bg-green-500/10 border-green-500/20 text-green-700 border"
                            : "bg-red-500/10 border-red-500/20 text-red-700 border"
                        }
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${
                            fy.status === "Active"
                              ? "bg-green-500"
                              : "bg-red-500"
                          }`}
                        />
                        {fy.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={fy.locked ? "destructive" : "secondary"}>
                        {fy.locked ? "Locked" : "Unlocked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-1">
                      {/* FIX: Edit button calls openEditDialog which sets state then opens dialog.
                          This works because dialog is NOT wrapped in a DialogTrigger anymore. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => openEditDialog(fy)}
                      >
                        <Edit3 className="w-4 h-4 mr-1" />
                        Edit
                      </Button>

                      {/* FIX: Lock/Unlock calls toggleLock which only sends FisLocked
                          to the backend — no risk of nullifying other fields. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => handleToggleLock(fy.id, fy.locked)}
                      >
                        {fy.locked ? (
                          <Unlock className="w-4 h-4 mr-1" />
                        ) : (
                          <Lock className="w-4 h-4 mr-1" />
                        )}
                        {fy.locked ? "Unlock" : "Lock"}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:bg-destructive/5"
                        onClick={() => setDeletingId(fy.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
