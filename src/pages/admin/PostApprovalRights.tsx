import React, { useState, useMemo, useCallback } from "react";
import { 
  useAuth, 
  PAGE_DEFINITIONS, 
  type PageKey, 
  type PageAction, 
  type PagePermission, 
  type AppUser 
} from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ShieldCheck, Plus, Search, Trash2, Edit3, UserCheck, Eye, PlusCircle, Edit, Trash, Printer, EyeOff, Download, CheckCircle, XCircle } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
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

// Shared Action config for descriptive labels and icons
const ACTION_CONFIG: Record<PageAction, { label: string; icon: React.ReactNode }> = {
  view: { label: "View", icon: <Eye className="w-3 h-3" /> },
  create: { label: "Add", icon: <PlusCircle className="w-3 h-3" /> },
  edit: { label: "Edit", icon: <Edit className="w-3 h-3" /> },
  delete: { label: "Delete", icon: <Trash className="w-3 h-3" /> },
  print: { label: "Print", icon: <Printer className="w-3 h-3" /> },
  preview: { label: "Preview", icon: <EyeOff className="w-3 h-3" /> },
  export: { label: "CSV Export", icon: <Download className="w-3 h-3" /> },
  approve: { label: "Approve", icon: <CheckCircle className="w-3 h-3" /> },
  reject: { label: "Reject", icon: <XCircle className="w-3 h-3" /> },
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
  const { allUsers, updateUserPagePermissions, toggleUserStatus, deleteUser } = useAuth();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<PagePermission[]>([]);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Compute table data from real users and PAGE_DEFINITIONS
  const tableData = useMemo<PermissionRow[]>(() => {
    const rows: PermissionRow[] = [];
    allUsers.forEach((user) => {
      if (user.role === "super_admin") return;
      PAGE_DEFINITIONS.forEach((def) => {
        const userPerm = user.pagePermissions.find(p => p.page === def.key);
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
          actions: userActions.map(a => ACTION_CONFIG[a]?.label || a).join(", "),
          status: user.isActive ? "Active" : "Inactive",
        });
      });
    });
    return rows;
  }, [allUsers]);

  const filteredData = useMemo(() => 
    tableData.filter(row => 
      row.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.pageLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.role.toLowerCase().includes(searchTerm.toLowerCase())
    ), [tableData, searchTerm]);

  const handleSavePermissions = useCallback(() => {
    if (!selectedUser) return;
    updateUserPagePermissions(selectedUser.id, pendingPermissions);
    toast({
      title: "Permissions Updated",
      description: `Updated post-approval rights for ${selectedUser.name}`,
    });
    setShowEditDialog(false);
    setSelectedUser(null);
    setPendingPermissions([]);
  }, [selectedUser, pendingPermissions, updateUserPagePermissions, toast]);

  const handleToggleStatus = useCallback((userId: string) => {
    toggleUserStatus(userId);
    toast({
      title: "Status Updated",
      description: "User status toggled successfully",
    });
  }, [toggleUserStatus, toast]);

  const handleDeleteUser = useCallback(() => {
    if (deletingUserId) {
      deleteUser(deletingUserId);
      toast({
        title: "User Deleted",
        description: "User and permissions removed",
        variant: "destructive",
      });
      setDeletingUserId(null);
    }
  }, [deletingUserId, deleteUser, toast]);

  const openEditDialog = useCallback((user: AppUser) => {
    setSelectedUser(user);
    setPendingPermissions([...user.pagePermissions]);
    setShowEditDialog(true);
  }, [allUsers]);

  const pageGroups = useMemo(() => {
    const groups: Record<string, {key: PageKey; label: string; actions: PageAction[]}[]> = {};
    PAGE_DEFINITIONS.forEach((def) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({ key: def.key, label: def.label, actions: def.availableActions });
    });
    return groups;
  }, []);

  return (
    <AppLayout>
      <Breadcrumbs items={["Admin", "Approval", "Post Approval Rights"]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" />
            Post Approval Rights
          </h1>
          <p className="text-muted-foreground mt-1">Manage permissions for actions after approval workflow completion</p>
        </div>
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Assign Rights
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Edit Post-Approval Permissions</DialogTitle>
              <DialogDescription>
                Configure access for {selectedUser?.name || "selected user"} across modules
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
              <Button type="submit" onClick={handleSavePermissions}>
                Save Permissions
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Post Approval Permissions</CardTitle>
            <CardDescription>Real-time control over post-approval actions ({filteredData.length} permissions)</CardDescription>
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
                <TableHead>Post Approval Rights</TableHead>
                <TableHead>Actions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    {searchTerm ? "No matching permissions found" : "No post-approval permissions assigned yet. Assign one above."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((row) => {
                  const user = allUsers.find((u) => u.id === row.userId);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.name}
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </TableCell>
                      <TableCell className="font-medium">{row.pageLabel}</TableCell>
                      <TableCell>
                        {row.actions.split(", ").map((actionLabel) => (
                          <Badge key={actionLabel} variant="secondary" className="mr-1 text-xs">
                            {actionLabel}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "Active" ? "default" : "destructive"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => user && openEditDialog(user)}
                        >
                          <Edit3 className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => handleToggleStatus(row.userId)}
                        >
                          <UserCheck className="w-4 h-4 mr-1" />
                          {row.status === "Active" ? "Deactivate" : "Activate"}
                        </Button>
                        <AlertDialog open={deletingUserId === row.userId} onOpenChange={(open) => !open && setDeletingUserId(null)}>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove {row.name} ({row.email}) and all their permissions.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive" onClick={handleDeleteUser}>
                                Delete User
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
    </AppLayout>
  );
}

