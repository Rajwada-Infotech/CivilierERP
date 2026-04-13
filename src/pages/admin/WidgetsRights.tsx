import React, { useState, useMemo, useCallback } from "react";
import {
  useAuth,
  PAGE_DEFINITIONS,
  type PageAction,
  type PagePermission,
  type AppUser,
} from "@/contexts/AuthContext";
import {
  Plus,
  Search,
  Trash2,
  Edit3,
  Eye,
  PlusCircle,
  Edit2,
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
import { Breadcrumbs } from "@/components/Breadcrumbs";

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode }> =
  {
    view: { label: "View", icon: <Eye className="w-3 h-3" /> },
    create: { label: "Add", icon: <PlusCircle className="w-3 h-3" /> },
    edit: { label: "Edit", icon: <Edit2 className="w-3 h-3" /> },
    delete: { label: "Delete", icon: <Trash2 className="w-3 h-3" /> },
    print: { label: "Print", icon: <Printer className="w-3 h-3" /> },
    preview: { label: "Preview", icon: <Eye className="w-3 h-3" /> },
    export: { label: "CSV Export", icon: <Download className="w-3 h-3" /> },
    approve: { label: "Approve", icon: <CheckCircle className="w-3 h-3" /> },
    reject: { label: "Reject", icon: <XCircle className="w-3 h-3" /> },
    pay: { label: "Pay", icon: <CreditCard className="w-3 h-3" /> },
    convert: { label: "Convert", icon: <ArrowRight className="w-3 h-3" /> },
  };

const getActionConfig = (action: string) =>
  ACTION_CONFIG[action] ?? {
    label: action.charAt(0).toUpperCase() + action.slice(1),
    icon: <Eye className="w-3 h-3" />,
  };

interface PermissionRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: AppUser["role"];
  pageKey: string;
  pageLabel: string;
  pageGroup: string;
  actions: string;
  status: string;
}

export default function WidgetsRights() {
  const { allUsers, updateUserPagePermissions, toggleUserStatus, deleteUser } =
    useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<
    PagePermission[]
  >([]);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const tableData = useMemo(() => {
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
      Array<{ key: string; label: string; actions: PageAction[] }>
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

  const updatePermission = useCallback(
    (pageKey: string, action: PageAction, checked: boolean) => {
      setPendingPermissions((prev) => {
        const idx = prev.findIndex((p) => p.page === pageKey);
        const current = idx >= 0 ? prev[idx].actions : [];
        const newActions = checked
          ? [...current, action]
          : current.filter((a) => a !== action);
        const newPerm: PagePermission = {
          page: pageKey,
          actions: newActions as PageAction[],
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

  const handleSavePermissions = useCallback(() => {
    if (!selectedUser) {
      toast.error("Please select a user");
      return;
    }
    updateUserPagePermissions(selectedUser.id, pendingPermissions);
    toast.success(`Permissions updated for ${selectedUser.name}`);
    setShowEditDialog(false);
    setSelectedUser(null);
    setPendingPermissions([]);
  }, [selectedUser, pendingPermissions, updateUserPagePermissions]);

  const handleToggleStatus = useCallback(
    (userId: string) => {
      toggleUserStatus(userId);
      toast.info("User status updated successfully");
    },
    [toggleUserStatus],
  );

  const handleDeleteUser = useCallback(() => {
    if (deletingUserId) {
      deleteUser(deletingUserId);
      toast.error("User deleted permanently", {
        description: "All permissions have been removed.",
      });
      setDeletingUserId(null);
    }
  }, [deletingUserId, deleteUser]);

  // FIX: openEditDialog sets the user so Save is immediately enabled
  const openEditDialog = useCallback((user: AppUser) => {
    setSelectedUser(user);
    setPendingPermissions([...(user.pagePermissions || [])]);
    setShowEditDialog(true);
  }, []);

  // FIX: new-assignment button opens dialog without pre-selecting — user picks from selector
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

  return (
    <>
      {/* FIX: Breadcrumbs were missing from WidgetsRights */}
      <Breadcrumbs items={["Admin", "Rights", "Widgets Rights"]} />

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Widgets Rights</h1>
          <p className="text-muted-foreground mt-1">
            Manage widget access permissions for users
          </p>
        </div>
        {/* FIX: no longer uses DialogTrigger wrapping — opens with openNewDialog so state is clean */}
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Manage Permissions
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Widgets Permissions</CardTitle>
          <CardDescription>
            Real-time user widget access control ({filteredData.length} entries)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-6">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, page or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Widget / Page</TableHead>
                <TableHead>Allowed Actions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                      : "No widget permissions assigned yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((row) => {
                  const user = allUsers.find((u) => u.id === row.userId);
                  return (
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
                          {row.actions.split(", ").map((actionLabel) => {
                            const config = getActionConfig(
                              actionLabel.toLowerCase(),
                            );
                            return (
                              <Badge
                                key={actionLabel}
                                variant="secondary"
                                className="text-xs flex items-center gap-1"
                              >
                                {config.icon}
                                {config.label}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "Active" ? "default" : "secondary"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => user && openEditDialog(user)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(row.userId)}
                        >
                          {row.status === "Active" ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeletingUserId(row.userId)}
                        >
                          <Trash className="h-4 w-4" />
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

      {/* Edit / Assign Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedUser
                ? `Edit Widget Permissions — ${selectedUser.name}`
                : "Assign Widget Permissions"}
            </DialogTitle>
            <DialogDescription>
              Toggle widget access rights for each module
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* FIX: user selector present so "Manage Permissions" CTA is functional */}
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={selectedUser?.id ?? ""}
                onValueChange={(id) => {
                  const user = allUsers.find((u) => u.id === id);
                  if (user) {
                    setSelectedUser(user);
                    setPendingPermissions([...(user.pagePermissions || [])]);
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

            <div className="space-y-3 max-h-[55vh] overflow-auto p-2 border rounded-md">
              {Object.entries(pageGroups).map(([group, pages]) => (
                <Collapsible key={group} defaultOpen>
                  <CollapsibleTrigger className="w-full flex items-center gap-2 p-3 hover:bg-accent rounded-md text-left">
                    <div className="font-semibold">{group}</div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pl-4 pt-2">
                    {pages.map(({ key, label, actions }) => {
                      const currentPerm = pendingPermissions.find(
                        (p) => p.page === key,
                      );
                      const currentActions = currentPerm?.actions || [];
                      return (
                        <div
                          key={key}
                          className="flex items-start gap-4 p-4 border rounded-lg bg-card"
                        >
                          <Label className="text-sm font-medium w-52 pt-1 flex-shrink-0">
                            {label}
                          </Label>
                          <div className="flex gap-2 flex-wrap">
                            {actions.map((action) => {
                              const config = getActionConfig(action);
                              const checked = currentActions.includes(action);
                              return (
                                <div
                                  key={action}
                                  className="flex items-center gap-2 px-3 py-2 border rounded-md hover:border-primary/50 transition-all"
                                >
                                  <Checkbox
                                    id={`wr-${key}-${action}`}
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
                                    htmlFor={`wr-${key}-${action}`}
                                    className="text-xs font-medium cursor-pointer flex items-center gap-1.5"
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
            {/* FIX: disabled clearly when no user selected */}
            <Button onClick={handleSavePermissions} disabled={!selectedUser}>
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single AlertDialog outside the table loop */}
      <AlertDialog
        open={!!deletingUserId}
        onOpenChange={(open) => !open && setDeletingUserId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              user and remove all their permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingUserId(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive hover:bg-destructive/90"
            >
              Yes, Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
