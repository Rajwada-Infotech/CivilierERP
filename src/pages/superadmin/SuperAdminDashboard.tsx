import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SuperAdminShell } from "@/components/superadmin/SuperAdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  Crown,
  Database,
  Edit2,
  Globe,
  Key,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Unlock,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { getSystemMetrics, type SystemMetrics } from "@/api/metricsApi";
import {
  createTenant,
  deleteTenant,
  getTenants,
  patchTenantStatus,
  updateTenant,
} from "@/api/tenantApi";
import { getUsers, type User } from "@/api/userApi";

type DashboardTab = "tenants" | "users" | "metrics";

type TenantStatus = "active" | "suspended";

interface TenantApiRecord {
  tenant_id: string;
  name: string;
  domain?: string | null;
  admin_email?: string | null;
  plan?: string | null;
  status?: string | null;
  max_users?: number | null;
  db_name?: string | null;
  server?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity?: string | null;
  user_count?: number | null;
  users?: number | null;
}

interface TenantRecord {
  id: string;
  name: string;
  domain: string;
  adminEmail: string;
  plan: string;
  status: TenantStatus;
  users: number;
  maxUsers: number;
  dbName: string;
  server: string;
  createdAt: string;
  lastActivity: string;
}

interface TenantFormState {
  currentId: string;
  tenantId: string;
  name: string;
  domain: string;
  adminEmail: string;
  plan: string;
  maxUsers: string;
  dbName: string;
  server: string;
  status: TenantStatus;
}

interface NewTenantFormState {
  tenantId: string;
  name: string;
  domain: string;
  adminEmail: string;
  plan: string;
  maxUsers: string;
  dbName: string;
  server: string;
}

const TENANTS_QUERY_KEY = ["super-admin", "tenants"];
const USERS_QUERY_KEY = ["super-admin", "users"];
const METRICS_QUERY_KEY = ["super-admin", "metrics"];
const PLAN_OPTIONS = ["Starter", "Professional", "Enterprise"];

const EMPTY_ADD_FORM: NewTenantFormState = {
  tenantId: "",
  name: "",
  domain: "",
  adminEmail: "",
  plan: "Starter",
  maxUsers: "10",
  dbName: "",
  server: "",
};

const formatDate = (value?: string | number | null) => {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value?: string | number | null) => {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizePlan = (plan?: string | null) => {
  if (!plan) return "Starter";
  return plan
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const getTenantStatus = (status?: string | null): TenantStatus =>
  status === "suspended" ? "suspended" : "active";

const getUserTenantId = (user: User) =>
  (user.tenant_id || user.tenantId || "").trim();

const parseTopEngagedUsers = (metrics?: SystemMetrics | null) => {
  if (!metrics?.topEngagedUsers?.length) return [];

  const pairs = metrics.topEngagedUsers;
  const users: { name: string; score: number }[] = [];

  for (let index = 0; index < pairs.length; index += 2) {
    users.push({
      name: pairs[index] || "Unknown",
      score: Number(pairs[index + 1] || 0),
    });
  }

  return users;
};

export default function SuperAdminDashboard() {
  usePageRights("superadmin-dashboard");
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TenantRecord | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTenant, setSearchTenant] = useState("");
  const [searchUsers, setSearchUsers] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("tenants");
  const [editForm, setEditForm] = useState<TenantFormState | null>(null);
  const [addForm, setAddForm] = useState<NewTenantFormState>(EMPTY_ADD_FORM);

  const {
    data: tenantRows = [],
    isLoading: tenantsLoading,
    isFetching: tenantsFetching,
    refetch: refetchTenants,
  } = useQuery<TenantApiRecord[]>({
    queryKey: TENANTS_QUERY_KEY,
    queryFn: getTenants,
  });

  const {
    data: users = [],
    isLoading: usersLoading,
    isFetching: usersFetching,
    refetch: refetchUsers,
  } = useQuery<User[]>({
    queryKey: USERS_QUERY_KEY,
    queryFn: getUsers,
  });

  const {
    data: metrics,
    isLoading: metricsLoading,
    isFetching: metricsFetching,
    error: metricsError,
    refetch: refetchMetrics,
  } = useQuery<SystemMetrics>({
    queryKey: METRICS_QUERY_KEY,
    queryFn: getSystemMetrics,
    refetchInterval: 30000,
  });

  const userCountsByTenant = useMemo(() => {
    const counts: Record<string, number> = {};

    users.forEach((user) => {
      const tenantId = getUserTenantId(user);
      if (!tenantId) return;
      counts[tenantId] = (counts[tenantId] || 0) + 1;
    });

    return counts;
  }, [users]);

  const tenants = useMemo<TenantRecord[]>(
    () =>
      tenantRows.map((tenant) => ({
        id: tenant.tenant_id,
        name: tenant.name,
        domain: tenant.domain || "—",
        adminEmail: tenant.admin_email || "—",
        plan: normalizePlan(tenant.plan),
        status: getTenantStatus(tenant.status),
        users:
          userCountsByTenant[tenant.tenant_id] ??
          Number(tenant.user_count ?? tenant.users ?? 0),
        maxUsers: Number(tenant.max_users ?? 0),
        dbName: tenant.db_name || "—",
        server: tenant.server || "—",
        createdAt: tenant.created_at || "",
        lastActivity:
          tenant.last_activity || tenant.updated_at || tenant.created_at || "",
      })),
    [tenantRows, userCountsByTenant],
  );

  const filteredTenants = useMemo(
    () =>
      tenants
        .filter((tenant) => filterStatus === "all" || tenant.status === filterStatus)
        .filter((tenant) => {
          const query = searchTenant.trim().toLowerCase();
          if (!query) return true;

          return (
            tenant.name.toLowerCase().includes(query) ||
            tenant.id.toLowerCase().includes(query) ||
            tenant.domain.toLowerCase().includes(query) ||
            tenant.dbName.toLowerCase().includes(query)
          );
        }),
    [filterStatus, searchTenant, tenants],
  );

  const filteredUsers = useMemo(() => {
    const query = searchUsers.trim().toLowerCase();
    if (!query) return users;

    return users.filter((user) => {
      const tenantId = getUserTenantId(user);

      return (
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query) ||
        (user.roleName || "").toLowerCase().includes(query) ||
        tenantId.toLowerCase().includes(query)
      );
    });
  }, [searchUsers, users]);

  const topEngagedUsers = useMemo(() => parseTopEngagedUsers(metrics), [metrics]);

  const stats = [
    {
      label: "Total Tenants",
      value: tenants.length,
      icon: Building2,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Active Tenants",
      value: tenants.filter((tenant) => tenant.status === "active").length,
      icon: CheckCircle2,
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      label: "Total Users",
      value: users.length,
      icon: Users,
      color: "text-violet-500",
      bg: "bg-violet-500/10",
    },
    {
      label: "Live Active Users",
      value: metrics?.activeUsers ?? "—",
      icon: Activity,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ];

  const openEdit = (tenant: TenantRecord) => {
    setEditForm({
      currentId: tenant.id,
      tenantId: tenant.id,
      name: tenant.name,
      domain: tenant.domain === "—" ? "" : tenant.domain,
      adminEmail: tenant.adminEmail === "—" ? "" : tenant.adminEmail,
      plan: tenant.plan,
      maxUsers: String(tenant.maxUsers || ""),
      dbName: tenant.dbName === "—" ? "" : tenant.dbName,
      server: tenant.server === "—" ? "" : tenant.server,
      status: tenant.status,
    });
    setEditOpen(true);
  };

  const createTenantMutation = useMutation({
    mutationFn: async (form: NewTenantFormState) =>
      createTenant({
        tenant_id: form.tenantId.trim(),
        name: form.name.trim(),
        domain: form.domain.trim() || undefined,
        admin_email: form.adminEmail.trim() || undefined,
        plan: form.plan,
        max_users: Number(form.maxUsers || 0),
        db_name: form.dbName.trim() || undefined,
        server: form.server.trim() || undefined,
      }),
    onSuccess: async (_, form) => {
      await queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      setAddOpen(false);
      setAddForm(EMPTY_ADD_FORM);
      toast.success(`Tenant ${form.tenantId.trim()} created`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateTenantMutation = useMutation({
    mutationFn: async (form: TenantFormState) =>
      updateTenant(form.currentId, {
        tenant_id: form.tenantId.trim(),
        name: form.name.trim(),
        domain: form.domain.trim(),
        admin_email: form.adminEmail.trim(),
        plan: form.plan,
        max_users: Number(form.maxUsers || 0),
        db_name: form.dbName.trim(),
        server: form.server.trim(),
        status: form.status,
      }),
    onSuccess: async (_, form) => {
      await queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      setEditOpen(false);
      setEditForm(null);
      toast.success(`Tenant ${form.tenantId.trim()} updated`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (tenant: TenantRecord) =>
      patchTenantStatus(
        tenant.id,
        tenant.status === "active" ? "suspended" : "active",
      ),
    onSuccess: async (_, tenant) => {
      await queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      toast.success(
        `Tenant ${tenant.id} ${
          tenant.status === "active" ? "suspended" : "activated"
        }`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteTenantMutation = useMutation({
    mutationFn: async (tenant: TenantRecord) => deleteTenant(tenant.id),
    onSuccess: async (_, tenant) => {
      await queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      setDeleteTarget(null);
      toast.success(`Tenant ${tenant.id} removed`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshAll = async () => {
    await Promise.all([refetchTenants(), refetchUsers(), refetchMetrics()]);
  };

  const handleCreateTenant = () => {
    if (!addForm.tenantId.trim() || !addForm.name.trim()) {
      toast.error("Tenant ID and company name are required");
      return;
    }

    createTenantMutation.mutate(addForm);
  };

  const handleSaveEdit = () => {
    if (!editForm) return;
    if (!editForm.tenantId.trim() || !editForm.name.trim()) {
      toast.error("Tenant ID and company name are required");
      return;
    }

    updateTenantMutation.mutate(editForm);
  };

  const isMutating =
    createTenantMutation.isPending ||
    updateTenantMutation.isPending ||
    toggleStatusMutation.isPending ||
    deleteTenantMutation.isPending;

  const tabs: { key: DashboardTab; label: string; icon: typeof Building2 }[] = [
    { key: "tenants", label: "Tenant Management", icon: Building2 },
    { key: "users", label: "All Users", icon: Users },
    { key: "metrics", label: "System Metrics", icon: BarChart3 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs items={["Super Admin", "Dashboard"]} />

      <SuperAdminShell
        title="Super Admin Control Panel"
        subtitle="Live tenant, user, and platform visibility powered by backend data"
        icon={Crown}
        action={
          <div className="flex items-center gap-2">
            <Badge className="border-yellow-500/30 bg-yellow-500/15 px-3 text-xs text-yellow-600">
              <Crown size={10} className="mr-1" /> SUPER ADMIN
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={tenantsFetching || usersFetching || metricsFetching}
            >
              {tenantsFetching || usersFetching || metricsFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        }
      >
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${stat.bg}`}>
                <stat.icon size={18} className={stat.color} />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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

      {activeTab === "tenants" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Key size={16} className="text-primary" />
                Tenant Registry
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search tenant / ID..."
                  value={searchTenant}
                  onChange={(event) => setSearchTenant(event.target.value)}
                  className="h-8 w-44 text-xs"
                />
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus size={12} /> New Tenant
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>Company Name</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>DB Name</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantsLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading tenants...
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : filteredTenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        No tenants available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTenants.map((tenant) => (
                      <TableRow key={tenant.id} className="text-xs">
                        <TableCell>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-primary">
                            {tenant.id}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{tenant.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Globe size={11} />
                            {tenant.domain}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              tenant.plan === "Enterprise"
                                ? "border-yellow-500/40 text-yellow-600"
                                : tenant.plan === "Professional"
                                  ? "border-blue-500/40 text-blue-600"
                                  : "border-muted-foreground/40"
                            }`}
                          >
                            {tenant.plan}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {tenant.dbName}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              tenant.maxUsers > 0 &&
                              tenant.users >= tenant.maxUsers * 0.9
                                ? "font-semibold text-red-500"
                                : ""
                            }
                          >
                            {tenant.users}/{tenant.maxUsers || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[10px] ${
                              tenant.status === "active"
                                ? "border-green-500/30 bg-green-500/15 text-green-600"
                                : "border-red-500/30 bg-red-500/15 text-red-600"
                            }`}
                          >
                            {tenant.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(tenant.lastActivity)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => openEdit(tenant)}
                              disabled={isMutating}
                            >
                              <Edit2 size={12} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 ${
                                tenant.status === "active"
                                  ? "text-orange-500 hover:text-orange-600"
                                  : "text-green-500 hover:text-green-600"
                              }`}
                              onClick={() => toggleStatusMutation.mutate(tenant)}
                              disabled={isMutating}
                            >
                              {tenant.status === "active" ? (
                                <Lock size={12} />
                              ) : (
                                <Unlock size={12} />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-500 hover:text-red-600"
                              onClick={() => setDeleteTarget(tenant)}
                              disabled={isMutating}
                            >
                              <Trash2 size={12} />
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
      )}

      {activeTab === "users" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users size={16} className="text-primary" />
                All Users
              </CardTitle>
              <Input
                placeholder="Search users..."
                value={searchUsers}
                onChange={(event) => setSearchUsers(event.target.value)}
                className="h-8 w-56 text-xs"
              />
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
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading users...
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No users available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id} className="text-xs">
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {user.roleName || user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary">
                            {getUserTenantId(user) || "GLOBAL"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[10px] ${
                              user.discontinue
                                ? "border-red-500/30 bg-red-500/15 text-red-600"
                                : "border-green-500/30 bg-green-500/15 text-green-600"
                            }`}
                          >
                            {user.discontinue ? "suspended" : "active"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(user.created_datetime)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "metrics" && (
        <div className="space-y-6">
          {metricsError ? (
            <Card>
              <CardContent className="py-8 text-sm text-destructive">
                {(metricsError as Error).message || "Failed to load metrics."}
              </CardContent>
            </Card>
          ) : metricsLoading && !metrics ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading system metrics...
                </span>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                  {
                    label: "RPM",
                    value: metrics?.rpm ?? "—",
                    icon: Activity,
                    color: "text-blue-500",
                    bg: "bg-blue-500/10",
                  },
                  {
                    label: "Active Users",
                    value: metrics?.activeUsers ?? "—",
                    icon: Users,
                    color: "text-green-500",
                    bg: "bg-green-500/10",
                  },
                  {
                    label: "Cache Hit Rate",
                    value:
                      metrics != null
                        ? `${Math.round(metrics.cacheHitRate * 100)}%`
                        : "—",
                    icon: Database,
                    color: "text-violet-500",
                    bg: "bg-violet-500/10",
                  },
                  {
                    label: "Memory Usage",
                    value:
                      metrics != null
                        ? `${Math.round(metrics.memoryUsage * 100)}%`
                        : "—",
                    icon: BarChart3,
                    color: "text-amber-500",
                    bg: "bg-amber-500/10",
                  },
                ].map((item) => (
                  <Card key={item.label}>
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className={`rounded-lg p-2 ${item.bg}`}>
                        <item.icon size={18} className={item.color} />
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{item.value}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.label}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">System Health</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Redis", ok: !!metrics?.redisOk },
                      { label: "Worker", ok: !!metrics?.workerOk },
                      { label: "Persistence", ok: !!metrics?.aofOk },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <span className="text-sm">{item.label}</span>
                        <Badge
                          className={
                            item.ok
                              ? "border-green-500/30 bg-green-500/15 text-green-600"
                              : "border-red-500/30 bg-red-500/15 text-red-600"
                          }
                        >
                          {item.ok ? "OK" : "Down"}
                        </Badge>
                      </div>
                    ))}
                    <div className="pt-2 text-xs text-muted-foreground">
                      Last updated: {formatDateTime(metrics?.lastUpdated)}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top Engaged Users</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>User</TableHead>
                          <TableHead className="text-right">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topEngagedUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="py-10 text-center text-sm text-muted-foreground">
                              No engagement data available.
                            </TableCell>
                          </TableRow>
                        ) : (
                          topEngagedUsers.slice(0, 8).map((user, index) => (
                            <TableRow key={`${user.name}-${index}`} className="text-xs">
                              <TableCell className="font-medium">{user.name}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="outline">{user.score.toFixed(0)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}
      </SuperAdminShell>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Key size={16} className="text-primary" />
              Edit Tenant
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Tenant ID</Label>
              <Input
                value={editForm?.tenantId || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, tenantId: event.target.value }
                      : current,
                  )
                }
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name</Label>
              <Input
                value={editForm?.name || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Domain</Label>
              <Input
                value={editForm?.domain || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, domain: event.target.value }
                      : current,
                  )
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Admin Email</Label>
              <Input
                value={editForm?.adminEmail || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, adminEmail: event.target.value }
                      : current,
                  )
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">DB Name</Label>
              <Input
                value={editForm?.dbName || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, dbName: event.target.value }
                      : current,
                  )
                }
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Server</Label>
              <Input
                value={editForm?.server || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, server: event.target.value }
                      : current,
                  )
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select
                value={editForm?.plan}
                onValueChange={(value) =>
                  setEditForm((current) =>
                    current ? { ...current, plan: value } : current,
                  )
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {plan}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Users</Label>
              <Input
                type="number"
                value={editForm?.maxUsers || ""}
                onChange={(event) =>
                  setEditForm((current) =>
                    current
                      ? { ...current, maxUsers: event.target.value }
                      : current,
                  )
                }
                className="text-xs"
              />
            </div>
            <div className="col-span-2 flex items-center justify-between">
              <Label className="text-xs">Status</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {editForm?.status === "active" ? "Active" : "Suspended"}
                </span>
                <Switch
                  checked={editForm?.status === "active"}
                  onCheckedChange={(checked) =>
                    setEditForm((current) =>
                      current
                        ? {
                            ...current,
                            status: checked ? "active" : "suspended",
                          }
                        : current,
                    )
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(false)}
              disabled={updateTenantMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={updateTenantMutation.isPending}
            >
              {updateTenantMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus size={16} className="text-primary" />
              New Tenant
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Tenant ID *</Label>
              <Input
                value={addForm.tenantId}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    tenantId: event.target.value,
                  }))
                }
                className="font-mono text-xs"
                placeholder="TENANT-001"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name *</Label>
              <Input
                value={addForm.name}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Domain</Label>
              <Input
                value={addForm.domain}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    domain: event.target.value,
                  }))
                }
                className="text-xs"
                placeholder="company.com"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Admin Email</Label>
              <Input
                value={addForm.adminEmail}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    adminEmail: event.target.value,
                  }))
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">DB Name</Label>
              <Input
                value={addForm.dbName}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    dbName: event.target.value,
                  }))
                }
                className="font-mono text-xs"
                placeholder="company_prod"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Server</Label>
              <Input
                value={addForm.server}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    server: event.target.value,
                  }))
                }
                className="text-xs"
                placeholder="sql-primary-01"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select
                value={addForm.plan}
                onValueChange={(value) =>
                  setAddForm((current) => ({ ...current, plan: value }))
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {plan}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Users</Label>
              <Input
                type="number"
                value={addForm.maxUsers}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    maxUsers: event.target.value,
                  }))
                }
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
              disabled={createTenantMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateTenant}
              disabled={createTenantMutation.isPending}
            >
              {createTenantMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Tenant"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{deleteTarget?.name || deleteTarget?.id}</strong> from the
              tenant registry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTenantMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={() =>
                deleteTarget && deleteTenantMutation.mutate(deleteTarget)
              }
              disabled={deleteTenantMutation.isPending}
            >
              {deleteTenantMutation.isPending ? (
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
    </div>
  );
}