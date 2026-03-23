import React, { useState, useMemo, useCallback } from "react";
import { useFinYear, type FinYear } from "@/contexts/FinYearContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Calendar,
  Plus,
  Search,
  Trash2,
  Edit3,
  Lock,
  CalendarDays,
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
  DialogTrigger,
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
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function FinYearRights() {
  const { finYears, addFinYear, updateFinYear, toggleLock, deleteFinYear } =
    useFinYear();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingFinYear, setEditingFinYear] = useState<FinYear | null>(null);
  const [formData, setFormData] = useState({
    year: "",
    startDate: "",
    endDate: "",
    locked: false,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const openAddDialog = useCallback(() => {
    setEditingFinYear(null);
    setFormData({ year: "", startDate: "", endDate: "", locked: false });
    setShowDialog(true);
  }, []);

  const openEditDialog = useCallback((fy: FinYear) => {
    setEditingFinYear(fy);
    setFormData({
      year: fy.year,
      startDate: fy.startDate,
      endDate: fy.endDate,
      locked: fy.locked,
    });
    setShowDialog(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!formData.year || !formData.startDate || !formData.endDate) {
      toast({
        title: "Error",
        description: "Please fill all fields",
        variant: "destructive",
      });
      return;
    }
    if (editingFinYear) {
      updateFinYear(editingFinYear.id, formData);
      toast({ title: "Updated", description: `Updated ${formData.year}` });
    } else {
      addFinYear({
        year: formData.year,
        startDate: formData.startDate,
        endDate: formData.endDate,
        status: "Active" as const,
        locked: formData.locked,
      });
      toast({ title: "Added", description: `Added ${formData.year}` });
    }
    setShowDialog(false);
  }, [formData, editingFinYear, addFinYear, updateFinYear, toast]);

  const handleToggleLock = useCallback(
    (id: string) => {
      toggleLock(id);
      toast({ title: "Toggled", description: "Lock status updated" });
    },
    [toggleLock, toast],
  );

  const handleDelete = useCallback(() => {
    if (deletingId) {
      deleteFinYear(deletingId);
      toast({
        title: "Deleted",
        description: "Financial year removed",
        variant: "destructive",
      });
      setDeletingId(null);
    }
  }, [deletingId, deleteFinYear, toast]);

  const resetForm = useCallback(() => {
    setFormData({ year: "", startDate: "", endDate: "", locked: false });
    setEditingFinYear(null);
    setShowDialog(false);
  }, []);

  return (
    <AppLayout>
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
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="w-4 h-4 mr-2" />
              New Financial Year
            </Button>
          </DialogTrigger>
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
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Financial Years</CardTitle>
            <CardDescription>
              {filteredFinYears.length} active financial years
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
                      {fy.startDate} - {fy.endDate}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{fy.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={fy.locked ? "destructive" : "secondary"}>
                        {fy.locked ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => openEditDialog(fy)}
                      >
                        <Edit3 className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => handleToggleLock(fy.id)}
                      >
                        <Lock className="w-4 h-4 mr-1" />
                        {fy.locked ? "Unlock" : "Lock"}
                      </Button>
                      <AlertDialog
                        open={deletingId === fy.id}
                        onOpenChange={(open) => !open && setDeletingId(null)}
                      >
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {fy.year}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone.
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
    </AppLayout>
  );
}
