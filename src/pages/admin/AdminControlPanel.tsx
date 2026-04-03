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
  Shield,
  Users,
  Database,
  Activity,
  Key,
  Edit2,
  Plus,
  Trash2,
  Lock,
  Unlock,
  CheckCircle2,
  BarChart3,
  Settings,
  UserCheck,
  RefreshCw,
  FileText,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Mock company-scoped data ─────────────────────────────────────────────────
const COMPANY_USERS = [
  { id: 1, name: "Rajesh Kumar", email: "rajesh@civilier.com", role: "user", department: "Finance", status: "active", lastLogin: "2026-04-03 09:12", permissions: 14 },
  { id: 2, name: "Meena Patel", email: "meena@civilier.com", role: "user", department: "Material", status: "active", lastLogin: "2026-04-02 14:30", permissions: 6 },
  { id: 3, name: "Dinesh Sharma", email: "dinesh@civilier.com", role: "user", department: "Finance", status: "inactive", lastLogin: "2026-03-10 10:00", permissions: 6 },
  { id: 4, name: "Anita Nair", email: "anita@civilier.com", role: "user", department: "Accounts", status: "active", lastLogin: "2026-04-03 11:00", permissions: 10 },
];

const DB_TABLES = [
  { table: "dbo.users", rows: 18, lastWrite: "2026-04-03", size: "1.2 MB", status: "healthy" },
  { table: "dbo.enterprise", rows: 1, lastWrite: "2026-03-20", size: "0.1 MB", status: "healthy" },
  { table: "dbo.expense_booking", rows: 342, lastWrite: "2026-04-03", size: "8.4 MB", status: "healthy" },
  { table: "dbo.payment", rows: 156, lastWrite: "2026-04-02", size: "4.2 MB", status: "healthy" },
  { table: "dbo.purchase_orders", rows: 89, lastWrite: "2026-04-01", size: "3.1 MB", status: "warning" },
  { table: "dbo.account_group", rows: 24, lastWrite: "2026-02-14", size: "0.3 MB", status: "healthy" },
  { table: "dbo.hsn", rows: 512, lastWrite: "2026-03-05", size: "2.6 MB", status: "healthy" },
];

const ACTIVITY_LOG = [
  { time: "2026-04-03 11:42", user: "Rajesh Kumar", action: "Created new expense booking #EB-0891", module: "Finance" },
  { time: "2026-04-03 10:15", user: "Anita Nair", action: "Updated bank master - HDFC Bank details", module: "Masters" },
  { time: "2026-04-03 09:30", user: "Meena Patel", action: "Approved purchase order #PO-0342", module: "Material" },
  { time: "2026-04-02 17:20", user: "Admin User", action: "Reset password for Dinesh Sharma", module: "Admin" },
  { time: "2026-04-02 15:10", user: "Rajesh Kumar", action: "Exported payment report Q1-2026", module: "Finance" },
  { time: "2026-04-02 13:05", user: "Anita Nair", action: "Added new contractor: Sharma Constructions", module: "Masters" },
];

const DEPARTMENTS = ["Finance", "Material", "Accounts", "HR", "Operations"];

export default function AdminControlPanel() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState(COMPANY_USERS);
  const [activeTab, setActiveTab] = useState<"users" | "database" | "activity">("users");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [addForm, setAddForm] = useState({ name: "", email: "", role: "user", department: "Finance", password: "" });
  const [editForm, setEditForm] = useState<any>({});
  const [dbSearch, setDbSearch] = useState("");

  const stats = [
    { label: "Total Users", value: users.length, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Active", value: users.filter(u => u.status === "active").length, icon: UserCheck, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "DB Tables", value: DB_TABLES.length, icon: Database, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Activities Today", value: ACTIVITY_LOG.filter(a => a.time.startsWith("2026-04-03")).length, icon: Activity, color: "text-orange-500", bg: "bg-orange-500/10" },
  ];

  const tabs = [
    { key: "users", label: "User Management", icon: Users },
    { key: "database", label: "Database Access", icon: Database },
    { key: "activity", label: "User Activity", icon: Activity },
  ];

  const toggleStatus = (id: number) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: u.status === "active" ? "inactive" : "active" } : u));
    toast.success("User status updated");
  };

  const deleteUser = (id: number) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    toast.success("User removed");
  };

  const openEdit = (user: any) => {
    setSelectedUser(user);
    setEditForm({ ...user });
    setEditOpen(true);
  };

  const saveEdit = () => {
    setUsers(prev => prev.map(u => u.id === editForm.id ? { ...editForm } : u));
    setEditOpen(false);
    toast.success("User updated");
  };

  const addUser = () => {
    setUsers(prev => [...prev, {
      ...addForm,
      id: Date.now(),
      status: "active",
      lastLogin: "Never",
      permissions: 6,
    }]);
    setAddOpen(false);
    setAddForm({ name: "", email: "", role: "user", department: "Finance", password: "" });
    toast.success("User added");
  };

  const filteredTables = DB_TABLES.filter(t =>
    t.table.toLowerCase().includes(dbSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["Admin", "Control Panel"]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <Shield className="text-blue-500" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Admin Control Panel</h1>
          <p className="text-sm text-muted-foreground">Company-scoped user & database management</p>
        </div>
        <Badge className="ml-auto bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs px-3">
          <Shield size={10} className="mr-1" /> ADMIN
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map(s => (
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

      {/* USERS */}
      {activeTab === "users" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users size={16} className="text-primary" />
                Company Users
              </CardTitle>
              <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setAddOpen(true)}>
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
                    <TableHead>Department</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(user => (
                    <TableRow key={user.id} className="text-xs">
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>{user.department}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <Key size={11} className="text-muted-foreground" />
                          {user.permissions} pages
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.lastLogin}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${user.status === "active" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}`}>
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(user)}>
                            <Edit2 size={12} />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className={`h-6 w-6 ${user.status === "active" ? "text-orange-500" : "text-green-500"}`}
                            onClick={() => toggleStatus(user.id)}
                          >
                            {user.status === "active" ? <Lock size={12} /> : <Unlock size={12} />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteUser(user.id)}>
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
                Company Database · <span className="font-mono text-sm text-muted-foreground">civilier_prod</span>
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search table..."
                  value={dbSearch}
                  onChange={e => setDbSearch(e.target.value)}
                  className="h-8 text-xs w-44"
                />
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => toast.success("DB refreshed")}>
                  <RefreshCw size={12} /> Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Table Name</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last Write</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTables.map(t => (
                    <TableRow key={t.table} className="text-xs">
                      <TableCell className="font-mono text-[11px]">{t.table}</TableCell>
                      <TableCell>{t.rows.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">{t.size}</TableCell>
                      <TableCell className="text-muted-foreground">{t.lastWrite}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${t.status === "healthy" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-orange-500/15 text-orange-600 border-orange-500/30"}`}>
                          {t.status === "warning" && <AlertCircle size={9} className="mr-1" />}
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => toast.info(`Viewing ${t.table}`)}>
                          <FileText size={10} /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                {ACTIVITY_LOG.map((log, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono text-muted-foreground">{log.time}</TableCell>
                    <TableCell className="font-medium">{log.user}</TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{log.module}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input type={f.type} value={(addForm as any)[f.key]} onChange={e => setAddForm(p => ({ ...p, [f.key]: e.target.value }))} className="text-xs" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={addForm.department} onValueChange={v => setAddForm(p => ({ ...p, department: v }))}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={addUser} disabled={!addForm.name || !addForm.email}>Add User</Button>
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
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input value={editForm[f.key] || ""} onChange={e => setEditForm((p: any) => ({ ...p, [f.key]: e.target.value }))} className="text-xs" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={editForm.department} onValueChange={v => setEditForm((p: any) => ({ ...p, department: v }))}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
