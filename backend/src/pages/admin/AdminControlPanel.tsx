import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUsers, addUser, updateUser, deleteUser } from "@/api/userApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Shield,
  Users,
  Database,
  Activity,
  Edit2,
  Plus,
  Trash2,
  Unlock,
  UserCheck,
  RefreshCw,
  FileText,
  Key,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminControlPanel() {
  const qc = useQueryClient();
  const rights = usePageRights("users");
  const [activeTab, setActiveTab] = useState<"users" | "database" | "activity">(
    "users",
  );
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [, setSelectedUser] = useState<any>(null);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    role: "user",
    password: "",
  });
  const [editForm, setEditForm] = useState<any>({});
  const [dbSearch, setDbSearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);

  const { data: users = [] } = useQuery({
    queryKey: ["admin-users"],
    queryFn: getUsers,
  });

  const { data: systemMetrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ["system-metrics"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/system/metrics");
      if (!res.ok) throw new Error("Failed to load system metrics");
      return res.json().catch(() => ({}));
    },
    enabled: activeTab === "database",
    staleTime: 30_000,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["admin-activity", activityPage],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/user-activity?page=${activityPage}&limit=20`);
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json().catch(() => ({}));
    },
    enabled: activeTab === "activity",
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: () =>
      addUser({
        name: addForm.name,
        email: addForm.email,
        role: addForm.role,
        password: addForm.password,
      }),
    onSuccess: () => {
      toast.success("User added");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setAddOpen(false);
      setAddForm({ name: "", email: "", role: "user", password: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      updateUser(editForm.id, {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
      }),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      toast.success("User removed");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (user: any) =>
      updateUser(user.id, { discontinue: !user.discontinue }),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = [
    {
      label: "Total Users",
      value: users.length,
      icon: Users,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Active",
      value: users.filter((u: any) => !u.discontinue).length,
      icon: UserCheck,
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      label: "DB Tables",
      value: systemMetrics?.tables?.length ?? "—",
      icon: Database,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      label: "Server uptime",
      value: systemMetrics?.server?.uptimeHours != null ? `${systemMetrics.server.uptimeHours}h` : "—",
      icon: Activity,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
  ];

  const tabs = [
    { key: "users", label: "User Management", icon: Users },
    { key: "database", label: "Database Access", icon: Database },
    { key: "activity", label: "User Activity", icon: Activity },
  ];

  const openEdit = (user: any) => {
    setSelectedUser(user);
    setEditForm({ ...user });
    setEditOpen(true);
  };

  const tables: any[] = systemMetrics?.tables ?? [];
  const filteredTables = tables.filter((t: any) =>
    !dbSearch || t.name?.toLowerCase().includes(dbSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["Admin", "Control Panel"]} />

      <AdminShell
        title="Admin Control Panel"
        subtitle="Company-scoped user & database management"
        icon={Shield}
        action={
          <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs px-3">
            <Shield size={10} className="mr-1" /> ADMIN
          </Badge>
        }
      >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon size={18} className={s.color} />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* USERS */}
      {activeTab === "users" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users size={16} className="text-primary" />
                Company Users
              </CardTitle>
              <Button
                size="sm"
                className="h-8 text-xs gap-1 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={12} /> Add User
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className="text-xs">
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <Key size={11} className="text-muted-foreground" />—
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.last_login ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-[10px] ${!user.discontinue ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}`}
                        >
                          {!user.discontinue ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => openEdit(user)}
                          >
                            <Edit2 size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 ${!user.discontinue ? "text-orange-500" : "text-green-500"}`}
                            onClick={() => toggleStatusMutation.mutate(user)}
                          >
                            {!user.discontinue ? (
                              <Lock size={12} />
                            ) : (
                              <Unlock size={12} />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500"
                            onClick={() => deleteMutation.mutate(user.id)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* DATABASE */}
      {activeTab === "database" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database size={16} className="text-primary" />
                System metrics
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search table..."
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  className="h-8 text-xs w-44"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => refetchMetrics()}
                >
                  <RefreshCw size={12} /> Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {metricsLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading metrics…</div>
            ) : filteredTables.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {dbSearch ? "No tables match your search." : "No table metrics available."}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Table Name</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Total KB</TableHead>
                    <TableHead>Used KB</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTables.map((t) => (
                    <TableRow key={t.name} className="text-xs">
                      <TableCell className="font-mono text-[11px]">
                        {t.name}
                      </TableCell>
                      <TableCell>{(t.rows ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.totalKB != null ? `${t.totalKB.toLocaleString()} KB` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.usedKB != null ? `${t.usedKB.toLocaleString()} KB` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => toast.info(`Viewing ${t.name}`)}
                        >
                          <FileText size={10} /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ACTIVITY */}
      {activeTab === "activity" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-primary" />
              User Activity Log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading activity…</div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(activityData?.logs ?? activityData ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                      No activity records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  (activityData?.logs ?? activityData ?? []).map((log: any, i: number) => (
                    <TableRow key={log.id ?? i} className="text-xs">
                      <TableCell className="font-mono text-muted-foreground">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("en-IN") : log.time ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">{log.userName ?? log.user ?? "—"}</TableCell>
                      <TableCell>{log.eventType ?? log.event ?? log.action ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {log.resource ?? log.module ?? "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            )}
            {!activityLoading && (activityData?.logs ?? activityData ?? []).length > 0 && (
              <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  disabled={activityPage === 1}
                  onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                >Prev</Button>
                <span className="text-xs text-muted-foreground">Page {activityPage}</span>
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  disabled={(activityData?.logs ?? activityData ?? []).length < 20}
                  onClick={() => setActivityPage(p => p + 1)}
                >Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </AdminShell>

      {/* ADD USER DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus size={16} className="text-primary" /> Add User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {[
              { label: "Full Name", key: "name", type: "text" },
              { label: "Email", key: "email", type: "email" },
              { label: "Password", key: "password", type: "password" },
            ].map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type={f.type}
                  value={(addForm as any)[f.key]}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  className="text-xs"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90"
              onClick={() => addMutation.mutate()}
              disabled={!addForm.name || !addForm.email}
            >
              Add User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT USER DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Edit2 size={16} className="text-primary" /> Edit User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {[
              { label: "Full Name", key: "name" },
              { label: "Email", key: "email" },
            ].map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  value={editForm[f.key] || ""}
                  onChange={(e) =>
                    setEditForm((p: any) => ({ ...p, [f.key]: e.target.value }))
                  }
                  className="text-xs"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90" onClick={() => editMutation.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}