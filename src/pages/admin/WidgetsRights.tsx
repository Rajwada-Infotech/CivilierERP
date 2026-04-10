import React, { useState, useMemo, useCallback } from "react";
import {
  useAuth,
  PAGE_DEFINITIONS,
  type PageKey,
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
import { CreditCard, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
<<<<<<< HEAD
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,

} from "@/components/ui/select";
=======
>>>>>>> 4ad8f3040e3bec64eb74e5143d5643fc5335b1cb
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

<<<<<<< HEAD
// Shared Action config for descriptive labels and icons
const ACTION_CONFIG: Record<PageAction, { label: string; icon: React.ReactNode }> = {
  view: { label: "View", icon: <Eye className="w-3 h-3" /> },
  create: { label: "Add", icon: <PlusCircle className="w-3 h-3" /> },
  edit: { label: "Edit", icon: <Edit2 className="w-3 h-3" /> },
  delete: { label: "Delete", icon: <Trash className="w-3 h-3" /> },
  print: { label: "Print", icon: <Printer className="w-3 h-3" /> },
  preview: { label: "Preview", icon: <EyeOff className="w-3 h-3" /> },
  export: { label: "CSV Export", icon: <Download className="w-3 h-3" /> },
  approve: { label: "Approve", icon: <CheckCircle className="w-3 h-3" /> },
  reject: { label: "Reject", icon: <XCircle className="w-3 h-3" /> },
  pay: { label: "Pay", icon: <CreditCard className="w-3 h-3" /> },
  convert: { label: "Convert", icon: <ArrowRight className="w-3 h-3" /> },
=======
// Safe Action Config with fallback
const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode }> =
  {
    view: { label: "View", icon: <Eye className="h-4 w-4" /> },
    create: { label: "Add", icon: <PlusCircle className="h-4 w-4" /> },
    edit: { label: "Edit", icon: <Edit2 className="h-4 w-4" /> },
    delete: { label: "Delete", icon: <Trash2 className="h-4 w-4" /> },
    print: { label: "Print", icon: <Printer className="h-4 w-4" /> },
    preview: { label: "Preview", icon: <Eye className="h-4 w-4" /> },
    export: { label: "CSV Export", icon: <Download className="h-4 w-4" /> },
    approve: { label: "Approve", icon: <CheckCircle className="h-4 w-4" /> },
    reject: { label: "Reject", icon: <XCircle className="h-4 w-4" /> },
  };

const getActionConfig = (action: string) => {
  return (
    ACTION_CONFIG[action] || {
      label: action.charAt(0).toUpperCase() + action.slice(1),
      icon: <Eye className="h-4 w-4" />,
    }
  );
>>>>>>> 4ad8f3040e3bec64eb74e5143d5643fc5335b1cb
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

  // Table Data
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

  const filteredData = useMemo(() => {
    return tableData.filter(
      (row) =>
        row.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.pageLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.role.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [tableData, searchTerm]);

  const handleSavePermissions = useCallback(() => {
    if (!selectedUser) return;
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
      toast.error("User deleted", {
        description: "User and all permissions removed permanently.",
      });
      setDeletingUserId(null);
    }
  }, [deletingUserId, deleteUser]);

  const openEditDialog = useCallback((user: AppUser) => {
    setSelectedUser(user);
    setPendingPermissions([...(user.pagePermissions || [])]);
    setShowEditDialog(true);
  }, []);

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

  return (
    <>
      {/* Removed Breadcrumbs import and usage for now */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Widgets Rights</h1>
          <p className="text-muted-foreground mt-1">
            Manage widget access permissions for users
          </p>
        </div>

        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Widget Permission
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Widget Permissions</DialogTitle>
              <DialogDescription>
                Assign widget access for{" "}
                <strong>{selectedUser?.name || "the user"}</strong>
              </DialogDescription>
            </DialogHeader>
<<<<<<< HEAD
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>User</Label>
                <Select 
                  value={selectedUser?.id || ""} 
                  onValueChange={(id) => {
                    const user = allUsers.find((u) => u.id === id);
                    if (user) {
                      setSelectedUser(user);
                      setPendingPermissions([...user.pagePermissions]);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.filter((u) => u.role !== "super_admin").map((user) => (
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
                      {pages.map(({key, label, actions}) => {
                        const currentPerm = pendingPermissions.find((p) => p.page === key);
                        const currentActions = currentPerm?.actions || [];
                        return (
                          <div key={key} className="flex items-start gap-3 p-3 border rounded-md">
                            <Label className="text-sm font-medium w-48 pt-1 flex-shrink-0">{label}</Label>
                            <div className="flex gap-2 flex-wrap">
                              {actions.map((action) => {
                                const config = ACTION_CONFIG[action];
                                const checked = currentActions.includes(action);
                                return (
                                  <div key={action} className="flex items-center gap-1 p-1.5 border rounded-md hover:border-primary/50 transition-colors">
                                    <Checkbox
                                      id={`perm-${key}-${action}`}
                                      checked={checked}
                                      onCheckedChange={(checked) => {
                                        const newActions = checked
                                          ? [...currentActions, action]
                                          : currentActions.filter((a) => a !== action);
                                        const newPerm: PagePermission = { page: key, actions: newActions };
                                        setPendingPermissions((prev) => {
                                          const idx = prev.findIndex((p) => p.page === key);
                                          if (idx >= 0) {
                                            const copy = [...prev];
                                            copy[idx] = newPerm;
                                            return copy;
                                          }
                                          return [...prev, newPerm];
                                        });
                                      }}
                                    />
                                    <Label 
                                      htmlFor={`perm-${key}-${action}`} 
                                      className="text-xs font-medium cursor-pointer m-0 p-0 leading-none flex items-center gap-1 text-foreground/80 hover:text-foreground"
                                    >
                                      {config?.icon || <Eye className="w-3 h-3" />}
                                      {config?.label || action}
                                    </Label>
=======

            <div className="space-y-6 py-4">
              {Object.entries(pageGroups).map(([group, pages]) => (
                <Collapsible key={group} defaultOpen>
                  <CollapsibleTrigger className="text-lg font-semibold">
                    {group}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 space-y-5">
                    {pages.map(({ key, label, actions }) => {
                      const currentPerm = pendingPermissions.find(
                        (p) => p.page === key,
                      );
                      const currentActions = currentPerm?.actions || [];

                      return (
                        <div
                          key={key}
                          className="border rounded-xl p-5 bg-card"
                        >
                          <Label className="text-base font-medium mb-4 block">
                            {label}
                          </Label>
                          <div className="grid grid-cols-2 gap-4">
                            {actions.map((action) => {
                              const config = getActionConfig(action);
                              const checked = currentActions.includes(
                                action as PageAction,
                              );

                              return (
                                <label
                                  key={action}
                                  className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-muted/50"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(isChecked) => {
                                      const newActions = isChecked
                                        ? [...currentActions, action]
                                        : currentActions.filter(
                                            (a) => a !== action,
                                          );

                                      const newPerm: PagePermission = {
                                        page: key,
                                        actions: newActions as PageAction[],
                                      };

                                      setPendingPermissions((prev) => {
                                        const idx = prev.findIndex(
                                          (p) => p.page === key,
                                        );
                                        if (idx >= 0) {
                                          const copy = [...prev];
                                          copy[idx] = newPerm;
                                          return copy;
                                        }
                                        return [...prev, newPerm];
                                      });
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    {config.icon}
                                    <span className="font-medium">
                                      {config.label}
                                    </span>
>>>>>>> 4ad8f3040e3bec64eb74e5143d5643fc5335b1cb
                                  </div>
                                </label>
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

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSavePermissions}>Save Permissions</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Widgets Permissions</CardTitle>
          <CardDescription>
            Real-time user widget access control ({filteredData.length}{" "}
            permissions)
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
<<<<<<< HEAD
                          {row.actions.split(", ").map((actionLabel) => {
                            const action = actionLabel.toLowerCase() as keyof typeof ACTION_CONFIG;
                            const config = ACTION_CONFIG[action];
                            return (
                              <Badge key={actionLabel} variant="secondary" className="text-xs whitespace-nowrap">
                                {config?.icon || <Eye className="w-3 h-3 mr-1" />}
                                {config?.label || actionLabel}
                              </Badge>
                            );
                          })}
=======
                          {row.actions.split(", ").map((label, i) => (
                            <Badge key={i} variant="secondary">
                              {label}
                            </Badge>
                          ))}
>>>>>>> 4ad8f3040e3bec64eb74e5143d5643fc5335b1cb
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

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDeletingUserId(row.userId)}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove{" "}
                                <strong>{row.name}</strong> ({row.email}) and
                                all their permissions.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                onClick={() => setDeletingUserId(null)}
                              >
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleDeleteUser}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete User
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
