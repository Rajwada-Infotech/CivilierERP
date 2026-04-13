import React, { useState, useMemo, useCallback } from "react";
import {
  useAuth,
  PAGE_DEFINITIONS,
  type PageKey,
  type PageAction,
  type PagePermission,
  type AppUser,
} from "@/contexts/AuthContext";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ShieldCheck,
  Plus,
  Search,
  Trash2,
  Edit3,
  UserCheck,
  Eye,
  PlusCircle,
  Edit,
  Trash,
  Printer,
  Download,
  CheckCircle,
  XCircle,
  CreditCard,
  ArrowRight,
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

const ACTION_CONFIG: Record<
  PageAction,
  { label: string; icon: React.ReactNode }
> = {
  view: { label: "View", icon: <Eye className="w-3 h-3" /> },
  create: { label: "Create", icon: <PlusCircle className="w-3 h-3" /> },
  edit: { label: "Edit", icon: <Edit className="w-3 h-3" /> },
  delete: { label: "Delete", icon: <Trash className="w-3 h-3" /> },
  approve: { label: "Approve", icon: <CheckCircle className="w-3 h-3" /> },
  reject: { label: "Reject", icon: <XCircle className="w-3 h-3" /> },
  export: { label: "Export", icon: <Download className="w-3 h-3" /> },
  print: { label: "Print", icon: <Printer className="w-3 h-3" /> },
  pay: { label: "Pay", icon: <CreditCard className="w-3 h-3" /> },
  convert: { label: "Convert", icon: <ArrowRight className="w-3 h-3" /> },
};

const getActionConfig = (action: string) =>
  ACTION_CONFIG[action as PageAction] ?? {
    label: action.charAt(0).toUpperCase() + action.slice(1),
    icon: <Eye className="w-3 h-3" />,
  };

interface PermissionRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  pageKey: PageKey;
  pageLabel: string;
  pageGroup: string;
  actions: string;
  status: string;
}

export default function MenuRights() {
  const { allUsers, updateUserPagePermissions, toggleUserStatus, deleteUser } =
    useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  // FIX: dialog is controlled purely via state — no DialogTrigger.
  // This lets the row Edit button open the dialog with the correct user pre-loaded.
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<
    PagePermission[]
  >([]);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const tableData = useMemo<PermissionRow[]>(() => {
    const rows: PermissionRow[] = [];
    allUsers.forEach((user) => {
      if (user.role === "super_admin") return;
      PAGE_DEFINITIONS.forEach((def) => {
        const userPerm = user.pagePermissions?.find((p) => p.page === def.key);
        const userActions = userPerm?.actions || [];
        if (!userActions.includes("view")) return;
        rows.push({
          id: `${user.id}-${def.key}`,
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          pageKey: def.key,
          pageLabel: def.label,
          pageGroup: def.group,
          actions: userActions.map((a) => getActionConfig(a).label).join(", "),
          status: user.isActive ? "Active" : "Inactive",
        });
      });
    });
    return rows;
  }, [allUsers]);

  const filteredData = useMemo(
    () =>
      tableData.filter(
        (row) =>
          row.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          row.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          row.pageLabel.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [tableData, searchTerm],
  );

  const pageGroups = useMemo(() => {
    const groups: Record<
      string,
      { key: PageKey; label: string; actions: PageAction[] }[]
    > = {};
    PAGE_DEFINITIONS.forEach((def) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({
        key: def.key,
        label: def.label,
        actions: [...(def.availableActions || [])],
      });
    });
    return groups;
  }, []);

  // FIX: openEditDialog sets selectedUser and clones their permissions into local state.
  // Pending permissions are isolated to this dialog session — other pages/users are NOT affected.
  const openEditDialog = useCallback((user: AppUser) => {
    setSelectedUser(user);
    // Deep-clone permissions so edits don't mutate the context directly
    setPendingPermissions(
      (user.pagePermissions || []).map((p) => ({
        page: p.page,
        actions: [...p.actions],
      })),
    );
    setShowEditDialog(true);
  }, []);

  const openNewDialog = useCallback(() => {
    setSelectedUser(null);
    setPendingPermissions([]);
    setShowEditDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowEditDialog(false);
    setSelectedUser(null);
    setPendingPermissions([]);
  }, []);

  const handleSavePermissions = useCallback(async () => {
    if (!selectedUser) {
      toast.error("Please select a user first");
      return;
    }
    try {
      await updateUserPagePermissions(selectedUser.id, pendingPermissions);
      toast.success(`Permissions updated for ${selectedUser.name}`);
      closeDialog();
    } catch {
      toast.error("Failed to save permissions. Please try again.");
    }
  }, [selectedUser, pendingPermissions, updateUserPagePermissions, closeDialog]);

  const handleToggleStatus = useCallback(
    (userId: string) => {
      toggleUserStatus(userId);
      toast.success("User status updated");
    },
    [toggleUserStatus],
  );

  const handleDeleteUser = useCallback(() => {
    if (deletingUserId) {
      deleteUser(deletingUserId);
      toast.error("User deleted");
      setDeletingUserId(null);
    }
  }, [deletingUserId, deleteUser]);

  // FIX: updatePermission is scoped to (pageKey, action) independently.
  // Toggling "Edit" on page A does NOT touch "Edit" on page B — each (page, action)
  // pair is addressed by its own array slot in pendingPermissions.
  const updatePermission = useCallback(
    (pageKey: string, action: PageAction, checked: boolean) => {
      setPendingPermissions((prev) => {
        // Find existing entry for this specific page
        const idx = prev.findIndex((p) => p.page === pageKey);
        const currentActions = idx >= 0 ? [...prev[idx].actions] : [];

        // Add or remove only this specific action — other actions on this page untouched
        const newActions = checked
          ? currentActions.includes(action)
            ? currentActions
            : [...currentActions, action]
          : currentActions.filter((a) => a !== action);

        const newPerm: PagePermission = {
          page: pageKey as PageKey,
          actions: newActions,
        };

        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newPerm;
          return copy;
        }
        return [...prev, newPerm];
      });
    },
    [],
  );

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Menu Rights"]} />

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ShieldCheck className="w-9 h-9 text-primary" />
            Menu Rights
          </h1>
          <p className="text-muted-foreground mt-1">
            Control what each user can access
          </p>
        </div>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Manage Permissions
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Permissions Overview</CardTitle>
          <CardDescription>{filteredData.length} entries found</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by user or menu..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Menu</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center h-24 text-muted-foreground"
                    >
                      No matching records found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {row.email}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.pageLabel}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.actions.split(", ").map((act, i) => (
                            <Badge key={i} variant="secondary">
                              {act}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "Active" ? "default" : "destructive"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {/* FIX: row Edit finds the user and calls openEditDialog — dialog opens correctly
                              because it's no longer inside or competing with a DialogTrigger */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const user = allUsers.find(
                                (u) => u.id === row.userId,
                              );
                              if (user) openEditDialog(user);
                            }}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(row.userId)}
                          >
                            <UserCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setDeletingUserId(row.userId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit / Assign Dialog — fully state-controlled, no DialogTrigger */}
      <Dialog open={showEditDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedUser
                ? `Edit Permissions — ${selectedUser.name}`
                : "Assign Permissions"}
            </DialogTitle>
            <DialogDescription>
              Toggle access rights for each module
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={selectedUser?.id ?? ""}
                onValueChange={(id) => {
                  const user = allUsers.find((u) => u.id === id);
                  if (user) {
                    setSelectedUser(user);
                    setPendingPermissions(
                      (user.pagePermissions || []).map((p) => ({
                        page: p.page,
                        actions: [...p.actions],
                      })),
                    );
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {allUsers
                    .filter((u) => u.role !== "super_admin")
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.email}) — {u.role}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-[52vh] overflow-y-auto pr-2 space-y-6">
              {Object.entries(pageGroups).map(([group, pages]) => (
                <Collapsible key={group} defaultOpen>
                  <CollapsibleTrigger className="w-full text-left font-semibold text-lg border-b pb-2 hover:text-primary">
                    {group}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-4">
                    {pages.map(({ key, label, actions }) => {
                      const current = pendingPermissions.find(
                        (p) => p.page === key,
                      );
                      const currentActions = current?.actions || [];

                      return (
                        <div key={key} className="border rounded-lg p-4">
                          <Label className="font-medium text-base mb-3 block">
                            {label}
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {actions.map((action) => {
                              const config = getActionConfig(action);
                              // FIX: checked is computed per (key, action) — fully isolated
                              const checked = currentActions.includes(action);
                              return (
                                <div
                                  key={action}
                                  className="flex items-center gap-2 border rounded-md px-4 py-2.5 hover:bg-accent"
                                >
                                  <Checkbox
                                    // FIX: id uses page key + action — guaranteed unique, no cross-linking
                                    id={`mr-${key}-${action}`}
                                    checked={checked}
                                    onCheckedChange={(val) =>
                                      updatePermission(
                                        key,
                                        action,
                                        val as boolean,
                                      )
                                    }
                                  />
                                  <Label
                                    htmlFor={`mr-${key}-${action}`}
                                    className="cursor-pointer flex items-center gap-2"
                                  >
                                    {config.icon} {config.label}
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSavePermissions} disabled={!selectedUser}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — single AlertDialog outside the table loop */}
      <AlertDialog
        open={!!deletingUserId}
        onOpenChange={(open) => !open && setDeletingUserId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the user and all their permissions.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={handleDeleteUser}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
