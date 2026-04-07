import React, { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  PAGE_DEFINITIONS,
  type PageKey,
  type PageAction,
  type PagePermission,
} from "@/constants/pageDefinitions";

import type { AppUser } from "@/contexts/types"; // ← Import AppUser from your types file

import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ShieldCheck,
  Plus,
  Search,
  Trash2,
  Edit3,
  UserCheck,
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Action Config
const ACTION_CONFIG: Record<
  PageAction,
  { label: string; icon: React.ReactNode }
> = {
  view: { label: "View", icon: <span>👁️</span> },
  create: { label: "Create", icon: <span>➕</span> },
  edit: { label: "Edit", icon: <span>✏️</span> },
  delete: { label: "Delete", icon: <span>🗑️</span> },
  approve: { label: "Approve", icon: <span>✅</span> },
  reject: { label: "Reject", icon: <span>❌</span> },
  export: { label: "Export", icon: <span>📤</span> },
  print: { label: "Print", icon: <span>🖨️</span> },
  pay: { label: "Pay", icon: <span>💰</span> },
  convert: { label: "Convert", icon: <span>🔄</span> },
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
  const { allUsers, toggleUserStatus, deleteUser } = useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<
    PagePermission[]
  >([]);

  // Table Data
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
          actions: userActions
            .map((a) => ACTION_CONFIG[a]?.label || a)
            .join(", "),
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
        row.pageLabel.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [tableData, searchTerm]);

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
        actions: [...def.availableActions],
      });
    });

    return groups;
  }, []);

  const openEditDialog = (user: AppUser) => {
    setSelectedUser(user);
    setPendingPermissions([...user.pagePermissions]);
    setShowEditDialog(true);
  };

  const handleSavePermissions = () => {
    if (!selectedUser) return;
    // TODO: Connect to updateUserPagePermissions from context later
    toast.success(`Permissions updated for ${selectedUser.name}`);
    setShowEditDialog(false);
    setSelectedUser(null);
  };

  const handleToggleStatus = (userId: string) => {
    toggleUserStatus(userId);
    toast.success("Status updated");
  };

  const handleDeleteUser = (userId: string) => {
    deleteUser(userId);
    toast.error("User deleted");
  };

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
        <Button onClick={() => setShowEditDialog(true)}>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              openEditDialog(
                                allUsers.find((u) => u.id === row.userId)!,
                              )
                            }
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
                            onClick={() => handleDeleteUser(row.userId)}
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

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Edit Permissions — {selectedUser?.name}</DialogTitle>
            <DialogDescription>
              Toggle access rights for each module
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-6 py-4">
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
                            const config = ACTION_CONFIG[action];
                            const checked = currentActions.includes(action);

                            return (
                              <div
                                key={action}
                                className="flex items-center gap-2 border rounded-md px-4 py-2.5 hover:bg-accent"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(val) => {
                                    const newActions = val
                                      ? [...currentActions, action]
                                      : currentActions.filter(
                                          (a) => a !== action,
                                        );

                                    setPendingPermissions((prev) => {
                                      const idx = prev.findIndex(
                                        (p) => p.page === key,
                                      );
                                      if (idx >= 0) {
                                        const copy = [...prev];
                                        copy[idx] = {
                                          page: key,
                                          actions: newActions,
                                        };
                                        return copy;
                                      }
                                      return [
                                        ...prev,
                                        { page: key, actions: newActions },
                                      ];
                                    });
                                  }}
                                />
                                <Label className="cursor-pointer flex items-center gap-2">
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePermissions}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
