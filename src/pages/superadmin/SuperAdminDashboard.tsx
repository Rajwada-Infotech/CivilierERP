import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  Crown,
  Building2,
  Users,
  ShieldCheck,
  Activity,
  Database,
  Key,
  Edit2,
  Plus,
  Trash2,
  RefreshCw,
  Globe,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

// ─── Mock Tenant Data ─────────────────────────────────────────────────────────
const INITIAL_TENANTS = [
  {
    id: "T-001",
    name: "Civilier Constructions Pvt Ltd",
    domain: "civilier.com",
    adminEmail: "admin@civilier.com",
    plan: "Enterprise",
    status: "active",
    users: 18,
    maxUsers: 50,
    dbName: "civilier_prod",
    createdAt: "2024-01-15",
    lastActivity: "2026-04-03",
  },
  {
    id: "T-002",
    name: "Buildtech Infrastructure Ltd",
    domain: "buildtech.in",
    adminEmail: "admin@buildtech.in",
    plan: "Professional",
    status: "active",
    users: 9,
    maxUsers: 20,
    dbName: "buildtech_prod",
    createdAt: "2024-03-22",
    lastActivity: "2026-04-02",
  },
  {
    id: "T-003",
    name: "Apex Realty Developers",
    domain: "apexrealty.com",
    adminEmail: "admin@apexrealty.com",
    plan: "Starter",
    status: "suspended",
    users: 3,
    maxUsers: 10,
    dbName: "apex_prod",
    createdAt: "2024-06-10",
    lastActivity: "2026-03-15",
  },
  {
    id: "T-004",
    name: "Metro Projects Group",
    domain: "metroproj.co.in",
    adminEmail: "admin@metroproj.co.in",
    plan: "Professional",
    status: "active",
    users: 14,
    maxUsers: 20,
    dbName: "metro_prod",
    createdAt: "2024-09-01",
    lastActivity: "2026-04-03",
  },
];

const ALL_USERS_ACROSS_TENANTS = [
  { id: "u1", name: "Rajesh Kumar", email: "rajesh@civilier.com", tenantId: "T-001", role: "user", lastLogin: "2026-04-03 09:12", status: "active" },
  { id: "u2", name: "Meena Patel", email: "meena@civilier.com", tenantId: "T-001", role: "user", lastLogin: "2026-04-02 14:30", status: "active" },
  { id: "u3", name: "Admin User", email: "admin@civilier.com", tenantId: "T-001", role: "admin", lastLogin: "2026-04-03 08:00", status: "active" },
  { id: "u4", name: "Karan Singh", email: "karan@buildtech.in", tenantId: "T-002", role: "user", lastLogin: "2026-04-02 11:45", status: "active" },
  { id: "u5", name: "Priya Das", email: "priya@apexrealty.com", tenantId: "T-003", role: "admin", lastLogin: "2026-03-14 16:00", status: "suspended" },
  { id: "u6", name: "Rohit Verma", email: "rohit@metroproj.co.in", tenantId: "T-004", role: "user", lastLogin: "2026-04-03 10:22", status: "active" },
];

const AUDIT_LOG = [
  { time: "2026-04-03 10:14", actor: "superadmin", action: "Tenant T-002 plan upgraded to Professional", severity: "info" },
  { time: "2026-04-03 09:45", actor: "superadmin", action: "Tenant T-003 suspended due to non-payment", severity: "warning" },
  { time: "2026-04-02 18:22", actor: "superadmin", action: "New tenant T-004 created: Metro Projects Group", severity: "info" },
  { time: "2026-04-02 14:10", actor: "superadmin", action: "User priya@apexrealty.com force-logged-out", severity: "warning" },
  { time: "2026-04-01 11:05", actor: "superadmin", action: "Global DB maintenance window executed", severity: "critical" },
  { time: "2026-03-31 09:30", actor: "superadmin", action: "Tenant ID T-001 domain updated to civilier.com", severity: "info" },
];

const PLAN_OPTIONS = ["Starter", "Professional", "Enterprise"];

export default function SuperAdminDashboard() {
  const [tenants, setTenants] = useState(INITIAL_TENANTS);
  const [selectedTenant, setSelectedTenant] = useState<typeof INITIAL_TENANTS[0] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTenant, setSearchTenant] = useState("");
  const [activeTab, setActiveTab] = useState<"tenants" | "users" | "audit">("tenants");
  const [editForm, setEditForm] = useState<any>({});
  const [addForm, setAddForm] = useState({ name: "", domain: "", adminEmail: "", plan: "Starter", maxUsers: "10", dbName: "" });

  const stats = [
    { label: "Total Tenants", value: tenants.length, icon: Building2, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Active Tenants", value: tenants.filter(t => t.status === "active").length, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "Total Users", value: ALL_USERS_ACROSS_TENANTS.length, icon: Users, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Suspended", value: tenants.filter(t => t.status === "suspended").length, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const filteredTenants = tenants
    .filter(t => filterStatus === "all" || t.status === filterStatus)
    .filter(t => t.name.toLowerCase().includes(searchTenant.toLowerCase()) || t.id.toLowerCase().includes(searchTenant.toLowerCase()));

  const openEdit = (tenant: typeof INITIAL_TENANTS[0]) => {
    setSelectedTenant(tenant);
    setEditForm({ ...tenant });
    setEditOpen(true);
  };

  const saveEdit = () => {
    setTenants(prev => prev.map(t => t.id === editForm.id ? { ...editForm } : t));
    setEditOpen(false);
    toast.success(`Tenant ${editForm.id} updated successfully`);
  };

  const toggleStatus = (id: string) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, status: t.status === "active" ? "suspended" : "active" } : t));
    const tenant = tenants.find(t => t.id === id);
    toast.success(`Tenant ${id} ${tenant?.status === "active" ? "suspended" : "activated"}`);
  };

  const deleteTenant = (id: string) => {
    setTenants(prev => prev.filter(t => t.id !== id));
    toast.success(`Tenant ${id} removed`);
  };

  const addTenant = () => {
    const newId = `T-${String(tenants.length + 1).padStart(3, "0")}`;
    setTenants(prev => [...prev, {
      ...addForm,
      id: newId,
      status: "active",
      users: 0,
      maxUsers: parseInt(addForm.maxUsers),
      createdAt: new Date().toISOString().split("T")[0],
      lastActivity: new Date().toISOString().split("T")[0],
    }]);
    setAddOpen(false);
    setAddForm({ name: "", domain: "", adminEmail: "", plan: "Starter", maxUsers: "10", dbName: "" });
    toast.success(`Tenant ${newId} created`);
  };

  const tabs = [
    { key: "tenants", label: "Tenant Management", icon: Building2 },
    { key: "users", label: "All Users", icon: Users },
    { key: "audit", label: "Audit Log", icon: Activity },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["Super Admin", "Dashboard"]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-yellow-500/10 rounded-lg">
          <Crown className="text-yellow-500" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Super Admin Control Panel</h1>
          <p className="text-sm text-muted-foreground">Global tenant & user management · Tenant ID manipulation</p>
        </div>
        <Badge className="ml-auto bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs px-3">
          <Crown size={10} className="mr-1" /> SUPER ADMIN
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className="border">
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
        {tabs.map(tab => (
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

      {/* TENANT MANAGEMENT */}
      {activeTab === "tenants" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Key size={16} className="text-primary" />
                Tenant Registry & ID Management
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search tenant / ID..."
                  value={searchTenant}
                  onChange={e => setSearchTenant(e.target.value)}
                  className="h-8 text-xs w-44"
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
                <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setAddOpen(true)}>
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
                  {filteredTenants.map(tenant => (
                    <TableRow key={tenant.id} className="text-xs">
                      <TableCell>
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-primary font-semibold">
                          {tenant.id}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{tenant.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex items-center gap-1"><Globe size={11} />{tenant.domain}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${
                          tenant.plan === "Enterprise" ? "border-yellow-500/40 text-yellow-600" :
                          tenant.plan === "Professional" ? "border-blue-500/40 text-blue-600" :
                          "border-muted-foreground/40"
                        }`}>
                          {tenant.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{tenant.dbName}</TableCell>
                      <TableCell>
                        <span className={tenant.users >= tenant.maxUsers * 0.9 ? "text-red-500 font-semibold" : ""}>
                          {tenant.users}/{tenant.maxUsers}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${
                          tenant.status === "active" ? "bg-green-500/15 text-green-600 border-green-500/30" :
                          "bg-red-500/15 text-red-600 border-red-500/30"
                        }`}>
                          {tenant.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{tenant.lastActivity}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(tenant)}>
                            <Edit2 size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 ${tenant.status === "active" ? "text-orange-500 hover:text-orange-600" : "text-green-500 hover:text-green-600"}`}
                            onClick={() => toggleStatus(tenant.id)}
                          >
                            {tenant.status === "active" ? <Lock size={12} /> : <Unlock size={12} />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-600" onClick={() => deleteTenant(tenant.id)}>
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

      {/* ALL USERS */}
      {activeTab === "users" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} className="text-primary" />
              All Users Across Tenants
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ALL_USERS_ACROSS_TENANTS.map(user => (
                    <TableRow key={user.id} className="text-xs">
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-primary text-[11px]">{user.tenantId}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${user.role === "admin" ? "border-blue-500/40 text-blue-600" : ""}`}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.lastLogin}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${user.status === "active" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}`}>
                          {user.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AUDIT LOG */}
      {activeTab === "audit" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-primary" />
              Global Audit Log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AUDIT_LOG.map((log, i) => (
                    <TableRow key={i} className="text-xs">
                      <TableCell className="font-mono text-muted-foreground">{log.time}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-600">
                          <Crown size={9} className="mr-1" />{log.actor}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.action}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${
                          log.severity === "critical" ? "bg-red-500/15 text-red-600 border-red-500/30" :
                          log.severity === "warning" ? "bg-orange-500/15 text-orange-600 border-orange-500/30" :
                          "bg-blue-500/15 text-blue-600 border-blue-500/30"
                        }`}>
                          {log.severity}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* EDIT TENANT DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Key size={16} className="text-primary" />
              Edit Tenant · <span className="font-mono text-primary">{editForm.id}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Tenant ID</Label>
              <Input
                value={editForm.id || ""}
                onChange={e => setEditForm((f: any) => ({ ...f, id: e.target.value }))}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-orange-500 flex items-center gap-1"><AlertTriangle size={10} />Changing Tenant ID affects all references. Proceed with caution.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name</Label>
              <Input value={editForm.name || ""} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Domain</Label>
              <Input value={editForm.domain || ""} onChange={e => setEditForm((f: any) => ({ ...f, domain: e.target.value }))} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Admin Email</Label>
              <Input value={editForm.adminEmail || ""} onChange={e => setEditForm((f: any) => ({ ...f, adminEmail: e.target.value }))} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">DB Name</Label>
              <Input value={editForm.dbName || ""} onChange={e => setEditForm((f: any) => ({ ...f, dbName: e.target.value }))} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select value={editForm.plan} onValueChange={v => setEditForm((f: any) => ({ ...f, plan: v }))}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Users</Label>
              <Input type="number" value={editForm.maxUsers || ""} onChange={e => setEditForm((f: any) => ({ ...f, maxUsers: parseInt(e.target.value) }))} className="text-xs" />
            </div>
            <div className="col-span-2 flex items-center justify-between">
              <Label className="text-xs">Status</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{editForm.status === "active" ? "Active" : "Suspended"}</span>
                <Switch
                  checked={editForm.status === "active"}
                  onCheckedChange={v => setEditForm((f: any) => ({ ...f, status: v ? "active" : "suspended" }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD TENANT DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus size={16} className="text-primary" />
              New Tenant Onboarding
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Company Name *</Label>
              <Input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Domain</Label>
              <Input value={addForm.domain} onChange={e => setAddForm(f => ({ ...f, domain: e.target.value }))} className="text-xs" placeholder="company.com" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Admin Email</Label>
              <Input value={addForm.adminEmail} onChange={e => setAddForm(f => ({ ...f, adminEmail: e.target.value }))} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">DB Name</Label>
              <Input value={addForm.dbName} onChange={e => setAddForm(f => ({ ...f, dbName: e.target.value }))} className="font-mono text-xs" placeholder="company_prod" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select value={addForm.plan} onValueChange={v => setAddForm(f => ({ ...f, plan: v }))}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Users</Label>
              <Input type="number" value={addForm.maxUsers} onChange={e => setAddForm(f => ({ ...f, maxUsers: e.target.value }))} className="text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={addTenant} disabled={!addForm.name}>Create Tenant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
