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

const ACTION_CONFIG: Partial<
  Record<PageAction, { label: string; icon: React.ReactNode }>
> = {
  view: { label: "View", icon: <Eye className="w-3 h-3" /> },
  create: { label: "Add", icon: <PlusCircle className="w-3 h-3" /> },
  edit: { label: "Edit", icon: <Edit className="w-3 h-3" /> },
  delete: { label: "Delete", icon: <Trash className="w-3 h-3" /> },
  print: { label: "Print", icon: <Printer className="w-3 h-3" /> },
  preview: { label: "Preview", icon: <Eye className="w-3 h-3" /> },
  export: { label: "CSV Export", icon: <Download className="w-3 h-3" /> },
  approve: { label: "Approve", icon: <CheckCircle className="w-3 h-3" /> },
  reject: { label: "Reject", icon: <XCircle className="w-3 h-3" /> },
};

const getActionConfig = (action: PageAction | string) => {
  const config = ACTION_CONFIG[action as PageAction];
  if (config) return config;
  return {
    label: action.charAt(0).toUpperCase() + action.slice(1),
    icon: <Eye className="w-3 h-3" />,
  };
};

interface PermissionRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: AppUser["role"];
  pageKey: PageKey;
  pageLabel: string;
  pageGroup: string;
  actions: string;
  status: string;
}

export default function PostApprovalRights() {
  const { allUsers, updateUserPagePermissions, toggleUserStatus, deleteUser } =
    useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  // FIX: Dialog is controlled entirely by state — no DialogTrigger.
  // Previously DialogTrigger on "Assign Rights" button conflicted with the row
  // Edit button calling openEditDialog() directly, causing the dialog to open
  // and immediately close (DialogTrigger toggled it back off).
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
          row.pageLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
          row.role.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [tableData, searchTerm],
  );

  const pageGroups = useMemo(() => {
    const groups: Record<
      string,
      Array<{ key: PageKey; label: string; actions: PageAction[] }>
    > = {};
    PAGE_DEFINITIONS.forEach((def) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({
        key: def.key,
        label: def.label,
        actions: def.availableActions || [],
      });
    });
    return groups;
  }, []);

  const handleSavePermissions = useCallback(async () => {
    if (!selectedUser) return;
    try {
      await updateUserPagePermissions(selectedUser.id, pendingPermissions);
      toast.success(`Permissions updated for ${selectedUser.name}`);
      closeDialog();
    } catch {
      toast.error("Failed to save permissions. Please try again.");
    }
  }, [selectedUser, pendingPermissions, updateUserPagePermissions]);

  // FIX: handleToggleStatus is a standalone action on a userId — completely independent
  // of Edit/Save dialogs. Each button in the row calls this directly.
  const handleToggleStatus = useCallback(
    (userId: string) => {
      toggleUserStatus(userId);
      toast.info("User status toggled successfully");
    },
    [toggleUserStatus],
  );

  const handleDeleteUser = useCallback(() => {
    if (deletingUserId) {
      deleteUser(deletingUserId);
      toast.error("User deleted", {
        description: "User and permissions removed permanently.",
      });
      setDeletingUserId(null);
    }
  }, [deletingUserId, deleteUser]);

  // FIX: openEditDialog sets user + clones permissions, then opens dialog.
  // Works correctly because there is no DialogTrigger competing for dialog state.
  const openEditDialog = useCallback((user: AppUser) => {
    setSelectedUser(user);
    setPendingPermissions(
      (user.pagePermissions || []).map((p) => ({
        page: p.page,
        actions: [...p.actions],
      })),
    );
    setShowEditDialog(true);
  }, []);

  // FIX: openNewDialog opens the dialog in "new assignment" mode — user picks from selector
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

  // FIX: updatePermission is per (pageKey, action) — toggling one action does not
  // affect any other action on any other page or the same page.
  const updatePermission = useCallback(
    (pageKey: PageKey, action: PageAction, isChecked: boolean) => {
      setPendingPermissions((prev) => {
        const idx = prev.findIndex((p) => p.page === pageKey);
        const currentActions = idx >= 0 ? [...prev[idx].actions] : [];

        const newActions = isChecked
          ? currentActions.includes(action)
            ? currentActions
            : [...currentActions, action]
          : currentActions.filter((a) => a !== action);

        const newPerm: PagePermission = {
          page: pageKey,
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
      <Breadcrumbs items={["Admin", "Approval", "Post Approval Rights"]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" />
            Post Approval Rights
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage permissions for actions after approval workflow completion
          </p>
        </div>

        {/* FIX: Plain button — no DialogTrigger — calls openNewDialog so state is set
            before dialog opens. Row Edit button calls openEditDialog the same way. */}
        <Button onClick={openNewDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Assign Rights
        </Button>
      </div>

      {/* FIX: Dialog is fully state-controlled — no DialogTrigger anywhere.
          Both "Assign Rights" (openNewDialog) and row "Edit" (openEditDialog)
          set state first then open the dialog cleanly with no toggle conflict. */}
      <Dialog open={showEditDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Post-Approval Permissions</DialogTitle>
            <DialogDescription>
              Configure access for {selectedUser?.name || "selected user"}{" "}
              across modules
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={selectedUser?.id || ""}
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
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {allUsers
                    .filter((u) => u.role !== "super_admin")
                    .map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} ({user.email}) - {user.role}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 max-h-80 overflow-auto p-2 border rounded-md">
              {Object.entries(pageGroups).map(([group, pages]) => (
                <Collapsible key={group} defaultOpen>
                  <CollapsibleTrigger className="w-full flex items-center gap-2 p-2 hover:bg-accent rounded-md">
                    <div className="font-medium">{group}</div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pl-4">
                    {pages.map(({ key, label, actions }) => {
                      const currentPerm = pendingPermissions.find(
                        (p) => p.page === key,
                      );
                      const currentActions = currentPerm?.actions || [];

                      return (
                        <div
                          key={key}
                          className="flex items-start gap-3 p-3 border rounded-md"
                        >
                          <Label className="text-sm font-medium w-48 pt-1 flex-shrink-0">
                            {label}
                          </Label>
                          <div className="flex gap-2 flex-wrap">
                            {actions.map((action) => {
                              const config = getActionConfig(action);
                              // FIX: checked is strictly per (key, action)
                              const checked = currentActions.includes(action);

                              return (
                                <div
                                  key={action}
                                  className="flex items-center gap-1 p-1.5 border rounded-md hover:border-primary/50 transition-colors"
                                >
                                  <Checkbox
                                    // FIX: unique id per page+action prevents label cross-linking
                                    id={`par-${key}-${action}`}
                                    checked={checked}
                                    onCheckedChange={(isChecked) =>
                                      updatePermission(
                                        key,
                                        action,
                                        isChecked as boolean,
                                      )
                                    }
                                  />
                                  <Label
                                    htmlFor={`par-${key}-${action}`}
                                    className="text-xs font-medium cursor-pointer m-0 p-0 leading-none flex items-center gap-1"
                                  >
                                    {config.icon}
                                    {config.label}
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
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Post Approval Permissions</CardTitle>
            <CardDescription>
              Real-time control over post-approval actions (
              {filteredData.length} permissions)
            </CardDescription>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users, modules..."
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
                <TableHead>User</TableHead>
                <TableHead>Module</TableHead>
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
                    className="h-24 text-center text-muted-foreground"
                  >
                    {searchTerm
                      ? "No matching permissions found"
                      : "No post-approval permissions assigned yet. Assign one above."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((row) => {
                  const user = allUsers.find((u) => u.id === row.userId);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.name}
                        <div className="text-xs text-muted-foreground">
                          {row.email}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.pageLabel}
                      </TableCell>
                      <TableCell>
                        {row.actions.split(", ").map((actionLabel, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="mr-1 text-xs"
                          >
                            {actionLabel}
                          </Badge>
                        ))}
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
                      <TableCell className="space-x-1">
                        {/* FIX: Edit button calls openEditDialog — works now because
                            dialog is state-controlled, not DialogTrigger-controlled */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => user && openEditDialog(user)}
                        >
                          <Edit3 className="w-4 h-4 mr-1" />
                          Edit
                        </Button>

                        {/* FIX: Toggle status is a standalone action — not linked to
                            the dialog. Each row's toggle is independent. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => handleToggleStatus(row.userId)}
                        >
                          <UserCheck className="w-4 h-4 mr-1" />
                          {row.status === "Active" ? "Deactivate" : "Activate"}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:bg-destructive/5"
                          onClick={() => setDeletingUserId(row.userId)}
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* FIX: AlertDialog is a SINGLE instance outside the table map() loop.
          Previously it was rendered inside the loop — one AlertDialog per row —
          causing multiple portal mounts and broken open/close state. */}
      <AlertDialog
        open={!!deletingUserId}
        onOpenChange={(open) => !open && setDeletingUserId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this user and all their permissions.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={handleDeleteUser}
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
