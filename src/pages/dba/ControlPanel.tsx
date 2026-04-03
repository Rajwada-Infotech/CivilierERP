import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Database,
  ShieldCheck,
  Clock,
  Calendar,
  Building2,
  Eye,
  Edit2,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Server,
  HardDrive,
  Users,
  Key,
  Timer,
  Zap,
  Star,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

type AccessLevel = "read" | "read_write" | "full";
type AccessStatus = "active" | "suspended" | "expired";

interface TenantAccess {
  id: string;
  tenantId: string;
  tenantName: string;
  dbName: string;
  server: string;
  accessLevel: AccessLevel;
  features: string[];
  grantedOn: string;
  expiresOn: string;
  daysRemaining: number;
  status: AccessStatus;
  paidAmount: number;
  plan: "starter" | "growth" | "enterprise";
  maxUsers: number;
  storageLimit: string;
  storageUsed: string;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const FEATURES_BY_PLAN: Record<string, string[]> = {
  starter: ["DB Read Access", "Query Console", "Basic Reporting"],
  growth: ["DB Read/Write", "Query Console", "Advanced Reports", "API Access", "Backups"],
  enterprise: ["Full DB Access", "Query Console", "All Reports", "API Access", "Backups", "Multi-Server", "Audit Logs", "Priority Support"],
};

const initialAccesses: TenantAccess[] = [
  {
    id: "ACC-001",
    tenantId: "T-001",
    tenantName: "Civilier Constructions Pvt Ltd",
    dbName: "civilier_prod",
    server: "sql-prod-01",
    accessLevel: "full",
    features: FEATURES_BY_PLAN.enterprise,
    grantedOn: "2026-01-01",
    expiresOn: "2026-12-31",
    daysRemaining: 272,
    status: "active",
    paidAmount: 84000,
    plan: "enterprise",
    maxUsers: 50,
    storageLimit: "50 GB",
    storageUsed: "2.8 GB",
  },
  {
    id: "ACC-002",
    tenantId: "T-002",
    tenantName: "Buildtech Infrastructure Ltd",
    dbName: "buildtech_prod",
    server: "sql-prod-01",
    accessLevel: "read_write",
    features: FEATURES_BY_PLAN.growth,
    grantedOn: "2026-02-15",
    expiresOn: "2026-05-15",
    daysRemaining: 42,
    status: "active",
    paidAmount: 18000,
    plan: "growth",
    maxUsers: 20,
    storageLimit: "20 GB",
    storageUsed: "1.1 GB",
  },
  {
    id: "ACC-003",
    tenantId: "T-003",
    tenantName: "Apex Realty Developers",
    dbName: "apex_prod",
    server: "sql-prod-02",
    accessLevel: "read",
    features: FEATURES_BY_PLAN.starter,
    grantedOn: "2025-12-01",
    expiresOn: "2026-03-01",
    daysRemaining: -33,
    status: "expired",
    paidAmount: 9000,
    plan: "starter",
    maxUsers: 5,
    storageLimit: "5 GB",
    storageUsed: "0.4 GB",
  },
  {
    id: "ACC-004",
    tenantId: "T-004",
    tenantName: "Metro Projects Group",
    dbName: "metro_prod",
    server: "sql-prod-02",
    accessLevel: "read_write",
    features: FEATURES_BY_PLAN.growth,
    grantedOn: "2026-03-01",
    expiresOn: "2026-06-01",
    daysRemaining: 59,
    status: "active",
    paidAmount: 18000,
    plan: "growth",
    maxUsers: 20,
    storageLimit: "20 GB",
    storageUsed: "1.9 GB",
  },
];

const ALL_TENANTS = [
  { id: "T-001", name: "Civilier Constructions Pvt Ltd", dbName: "civilier_prod", server: "sql-prod-01" },
  { id: "T-002", name: "Buildtech Infrastructure Ltd", dbName: "buildtech_prod", server: "sql-prod-01" },
  { id: "T-003", name: "Apex Realty Developers", dbName: "apex_prod", server: "sql-prod-02" },
  { id: "T-004", name: "Metro Projects Group", dbName: "metro_prod", server: "sql-prod-02" },
  { id: "T-005", name: "Urban Edge Builders", dbName: "urbanedge_prod", server: "sql-prod-03" },
];

const PLAN_CONFIG = {
  starter:    { label: "Starter",    color: "bg-slate-500/15 text-slate-600 border-slate-500/30",    price: "₹9,000/qtr",  icon: Zap },
  growth:     { label: "Growth",     color: "bg-blue-500/15 text-blue-600 border-blue-500/30",       price: "₹18,000/qtr", icon: Star },
  enterprise: { label: "Enterprise", color: "bg-violet-500/15 text-violet-600 border-violet-500/30", price: "₹84,000/yr",  icon: Shield },
};

const ACCESS_LEVEL_CONFIG = {
  read:       { label: "Read Only",   color: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30", icon: Eye },
  read_write: { label: "Read/Write",  color: "bg-blue-500/15 text-blue-600 border-blue-500/30",      icon: Edit2 },
  full:       { label: "Full Access", color: "bg-green-500/15 text-green-600 border-green-500/30",   icon: Unlock },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ControlPanel() {
  const [accesses, setAccesses] = useState<TenantAccess[]>(initialAccesses);
  const [selectedAccess, setSelectedAccess] = useState<TenantAccess | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TenantAccess | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Grant form state
  const [grantForm, setGrantForm] = useState({
    tenantId: "",
    plan: "growth" as "starter" | "growth" | "enterprise",
    accessLevel: "read_write" as AccessLevel,
    durationMonths: "3",
    paidAmount: "",
    maxUsers: "20",
    storageLimit: "20 GB",
  });

  const filtered = accesses.filter(a => filterStatus === "all" || a.status === filterStatus);

  const statusConfig = {
    active:    { color: "bg-green-500/15 text-green-600 border-green-500/30",   icon: CheckCircle2 },
    suspended: { color: "bg-orange-500/15 text-orange-600 border-orange-500/30", icon: AlertTriangle },
    expired:   { color: "bg-red-500/15 text-red-600 border-red-500/30",         icon: XCircle },
  };

  const getDaysColor = (days: number) => {
    if (days < 0) return "text-red-500";
    if (days <= 30) return "text-orange-500";
    if (days <= 60) return "text-yellow-600";
    return "text-green-600";
  };

  const handleGrant = () => {
    const tenant = ALL_TENANTS.find(t => t.id === grantForm.tenantId);
    if (!tenant || !grantForm.paidAmount) {
      toast.error("Please fill all required fields");
      return;
    }
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + parseInt(grantForm.durationMonths));
    const days = Math.floor((expires.getTime() - now.getTime()) / 86400000);

    const newAccess: TenantAccess = {
      id: `ACC-00${accesses.length + 1}`,
      tenantId: tenant.id,
      tenantName: tenant.name,
      dbName: tenant.dbName,
      server: tenant.server,
      accessLevel: grantForm.accessLevel,
      features: FEATURES_BY_PLAN[grantForm.plan],
      grantedOn: now.toISOString().split("T")[0],
      expiresOn: expires.toISOString().split("T")[0],
      daysRemaining: days,
      status: "active",
      paidAmount: parseInt(grantForm.paidAmount),
      plan: grantForm.plan,
      maxUsers: parseInt(grantForm.maxUsers),
      storageLimit: grantForm.storageLimit,
      storageUsed: "0 GB",
    };
    setAccesses(prev => [...prev, newAccess]);
    setGrantOpen(false);
    toast.success(`Access granted to ${tenant.name}`);
  };

  const handleRevoke = (access: TenantAccess) => {
    setAccesses(prev => prev.map(a => a.id === access.id ? { ...a, status: "suspended" } : a));
    setRevokeTarget(null);
    toast.success(`Access suspended for ${access.tenantName}`);
  };

  const handleReactivate = (access: TenantAccess) => {
    setAccesses(prev => prev.map(a => a.id === access.id ? { ...a, status: "active" } : a));
    toast.success(`Access reactivated for ${access.tenantName}`);
  };

  const stats = {
    total: accesses.length,
    active: accesses.filter(a => a.status === "active").length,
    expiringSoon: accesses.filter(a => a.daysRemaining > 0 && a.daysRemaining <= 30).length,
    expired: accesses.filter(a => a.status === "expired" || a.daysRemaining < 0).length,
    totalRevenue: accesses.reduce((s, a) => s + a.paidAmount, 0),
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "Database" }, { label: "Control Panel" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck size={20} className="text-emerald-500" /> DB Access Control Panel
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage tenant database access, plans & expiry</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setGrantOpen(true)}>
          <Plus size={13} /> Grant Access
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Tenants", value: stats.total, icon: Building2, color: "text-blue-500" },
          { label: "Active", value: stats.active, icon: CheckCircle2, color: "text-green-500" },
          { label: "Expiring Soon", value: stats.expiringSoon, icon: AlertTriangle, color: "text-orange-500" },
          { label: "Expired", value: stats.expired, icon: XCircle, color: "text-red-500" },
          { label: "Total Revenue", value: `₹${(stats.totalRevenue / 1000).toFixed(0)}K`, icon: Key, color: "text-violet-500" },
        ].map((s, i) => (
          <Card key={i} className="border">
            <CardContent className="p-3 flex items-center gap-3">
              <s.icon size={18} className={s.color} />
              <div>
                <div className="text-lg font-bold leading-none">{s.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", "active", "suspended", "expired"].map(f => (
          <Button
            key={f}
            size="sm"
            variant={filterStatus === f ? "default" : "outline"}
            className="text-xs h-7 capitalize"
            onClick={() => setFilterStatus(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {/* Access Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database size={14} className="text-emerald-500" /> Tenant Access Registry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Tenant</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Access Level</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((acc) => {
                  const SC = statusConfig[acc.status];
                  const PL = PLAN_CONFIG[acc.plan];
                  const AL = ACCESS_LEVEL_CONFIG[acc.accessLevel];
                  const storagePercent = Math.round(
                    (parseFloat(acc.storageUsed) / parseFloat(acc.storageLimit)) * 100
                  );
                  return (
                    <TableRow key={acc.id} className="text-xs">
                      <TableCell>
                        <div className="font-medium text-[11px]">{acc.tenantName}</div>
                        <div className="text-muted-foreground font-mono text-[10px]">{acc.tenantId}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-[10px] text-primary">{acc.dbName}</div>
                        <div className="text-muted-foreground text-[10px]">{acc.server}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${PL.color}`}>{PL.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${AL.color}`}>{AL.label}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{acc.expiresOn}</TableCell>
                      <TableCell>
                        <span className={`font-bold text-[11px] ${getDaysColor(acc.daysRemaining)}`}>
                          {acc.daysRemaining < 0 ? `${Math.abs(acc.daysRemaining)}d overdue` : `${acc.daysRemaining}d`}
                        </span>
                        {acc.daysRemaining > 0 && (
                          <div className="w-16 h-1 bg-muted rounded-full mt-1">
                            <div
                              className={`h-1 rounded-full ${acc.daysRemaining > 60 ? "bg-green-500" : acc.daysRemaining > 30 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min((acc.daysRemaining / 365) * 100, 100)}%` }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-[10px]">{acc.storageUsed} / {acc.storageLimit}</div>
                        <div className="w-16 h-1 bg-muted rounded-full mt-1">
                          <div
                            className={`h-1 rounded-full ${storagePercent > 80 ? "bg-red-500" : storagePercent > 60 ? "bg-yellow-500" : "bg-emerald-500"}`}
                            style={{ width: `${storagePercent}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${SC.color}`}>{acc.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => { setSelectedAccess(acc); setDetailOpen(true); }}
                          >
                            <Eye size={11} />
                          </Button>
                          {acc.status === "active" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-orange-500 hover:text-orange-600"
                              onClick={() => setRevokeTarget(acc)}
                            >
                              <Lock size={11} />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-green-500 hover:text-green-600"
                              onClick={() => handleReactivate(acc)}
                            >
                              <Unlock size={11} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Database size={15} className="text-emerald-500" />
              Access Details — {selectedAccess?.tenantId}
            </DialogTitle>
          </DialogHeader>
          {selectedAccess && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tenant</p>
                  <p className="text-xs font-medium">{selectedAccess.tenantName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Database</p>
                  <p className="text-xs font-mono text-primary">{selectedAccess.dbName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Plan</p>
                  <Badge className={`text-[10px] ${PLAN_CONFIG[selectedAccess.plan].color}`}>
                    {PLAN_CONFIG[selectedAccess.plan].label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Access Level</p>
                  <Badge className={`text-[10px] ${ACCESS_LEVEL_CONFIG[selectedAccess.accessLevel].color}`}>
                    {ACCESS_LEVEL_CONFIG[selectedAccess.accessLevel].label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Granted On</p>
                  <p className="text-xs font-mono">{selectedAccess.grantedOn}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Expires On</p>
                  <p className={`text-xs font-mono font-bold ${getDaysColor(selectedAccess.daysRemaining)}`}>
                    {selectedAccess.expiresOn}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Max Users</p>
                  <p className="text-xs">{selectedAccess.maxUsers} users</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Amount Paid</p>
                  <p className="text-xs font-bold text-green-600">₹{selectedAccess.paidAmount.toLocaleString()}</p>
                </div>
              </div>

              {/* Time remaining bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Access Duration</span>
                  <span className={`font-bold ${getDaysColor(selectedAccess.daysRemaining)}`}>
                    {selectedAccess.daysRemaining > 0 ? `${selectedAccess.daysRemaining} days remaining` : `${Math.abs(selectedAccess.daysRemaining)} days overdue`}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${selectedAccess.daysRemaining > 60 ? "bg-green-500" : selectedAccess.daysRemaining > 30 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{ width: `${Math.max(0, Math.min((selectedAccess.daysRemaining / 365) * 100, 100))}%` }}
                  />
                </div>
              </div>

              {/* Features */}
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Included Features</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAccess.features.map((f, i) => (
                    <span key={i} className="flex items-center gap-1 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 rounded-full px-2 py-0.5 text-[10px]">
                      <CheckCircle2 size={9} /> {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Plus size={14} className="text-emerald-500" /> Grant DB Access
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Tenant *</Label>
              <Select value={grantForm.tenantId} onValueChange={v => setGrantForm(f => ({ ...f, tenantId: v }))}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue placeholder="Select tenant..." />
                </SelectTrigger>
                <SelectContent>
                  {ALL_TENANTS.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Plan *</Label>
                <Select value={grantForm.plan} onValueChange={v => setGrantForm(f => ({ ...f, plan: v as any }))}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter" className="text-xs">Starter — ₹9,000/qtr</SelectItem>
                    <SelectItem value="growth" className="text-xs">Growth — ₹18,000/qtr</SelectItem>
                    <SelectItem value="enterprise" className="text-xs">Enterprise — ₹84,000/yr</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Access Level *</Label>
                <Select value={grantForm.accessLevel} onValueChange={v => setGrantForm(f => ({ ...f, accessLevel: v as any }))}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read" className="text-xs">Read Only</SelectItem>
                    <SelectItem value="read_write" className="text-xs">Read / Write</SelectItem>
                    <SelectItem value="full" className="text-xs">Full Access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duration (months) *</Label>
                <Select value={grantForm.durationMonths} onValueChange={v => setGrantForm(f => ({ ...f, durationMonths: v }))}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-xs">1 Month</SelectItem>
                    <SelectItem value="3" className="text-xs">3 Months</SelectItem>
                    <SelectItem value="6" className="text-xs">6 Months</SelectItem>
                    <SelectItem value="12" className="text-xs">12 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount Paid (₹) *</Label>
                <Input
                  className="text-xs h-8"
                  placeholder="e.g. 18000"
                  value={grantForm.paidAmount}
                  onChange={e => setGrantForm(f => ({ ...f, paidAmount: e.target.value }))}
                />
              </div>
            </div>

            {grantForm.plan && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Included Features</p>
                <div className="flex flex-wrap gap-1">
                  {FEATURES_BY_PLAN[grantForm.plan].map((f, i) => (
                    <span key={i} className="bg-background border rounded px-1.5 py-0.5 text-[10px]">{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleGrant}>Grant Access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-orange-500">
              <AlertTriangle size={14} /> Suspend Access?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground py-2">
            This will immediately suspend <strong>{revokeTarget?.tenantName}</strong>'s access to <span className="font-mono text-primary">{revokeTarget?.dbName}</span>. You can reactivate later.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={() => revokeTarget && handleRevoke(revokeTarget)}>
              Suspend Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
