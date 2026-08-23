import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
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
  Building2,
  Eye,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Key,
  Timer,
  Zap,
  Star,
  Shield,
  Edit2, // ← Added back (used in ACCESS_LEVEL_CONFIG)
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
type AccessLevel = "read" | "read_write" | "full";
type AccessStatus = "active" | "suspended" | "expired" | "trial";

interface TenantAccess {
  tenant_id: string;
  name: string;
  db_name: string;
  server: string;
  plan: "starter" | "growth" | "enterprise";
  max_users: number;
  access_level: AccessLevel;
  features: string | null;
  granted_on: string;
  expires_on: string;
  days_remaining: number;
  status: AccessStatus;
  is_trial: boolean;
  trial_ends_on?: string;
  paid_amount: number;
  storage_limit: string;
  storage_used: string;
  created_at: string;
}

const FEATURES_BY_PLAN: Record<string, string[]> = {
  starter: ["DB Read Access", "Query Console", "Basic Reporting"],
  growth: [
    "DB Read/Write",
    "Query Console",
    "Advanced Reports",
    "API Access",
    "Backups",
  ],
  enterprise: [
    "Full DB Access",
    "Query Console",
    "All Reports",
    "API Access",
    "Backups",
    "Multi-Server",
    "Audit Logs",
    "Priority Support",
  ],
};

const PLAN_CONFIG = {
  starter: {
    label: "Starter",
    color: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    price: "₹9,000/qtr",
    icon: Zap,
  },
  growth: {
    label: "Growth",
    color: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    price: "₹18,000/qtr",
    icon: Star,
  },
  enterprise: {
    label: "Enterprise",
    color: "bg-violet-500/15 text-violet-600 border-violet-500/30",
    price: "₹84,000/yr",
    icon: Shield,
  },
};

const ACCESS_LEVEL_CONFIG = {
  read: {
    label: "Read Only",
    color: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    icon: Eye,
  },
  read_write: {
    label: "Read/Write",
    color: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    icon: Edit2,
  },
  full: {
    label: "Full Access",
    color: "bg-green-500/15 text-green-600 border-green-500/30",
    icon: Unlock,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function ControlPanel() {
  usePageRights("dba-control-panel");
  const queryClient = useQueryClient();

  const { data: accesses = [], refetch } = useQuery<TenantAccess[]>({
    queryKey: ["dba-control-panel"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/control-panel");
      if (!res.ok) throw new Error("Failed to load tenants");
      return res.json().catch(() => ({}));
    },
  });

  const patchTenant = useMutation({
    mutationFn: async ({
      tenant_id,
      body,
    }: {
      tenant_id: string;
      body: Record<string, unknown>;
    }) => {
      const res = await fetchWithAuth(`/api/dba/control-panel/${tenant_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json().catch(() => ({}));
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["dba-control-panel"] }),
  });

  const [selectedAccess, setSelectedAccess] = useState<TenantAccess | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
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
    isTrial: false,
    trialDays: "14",
  });

  const filtered = accesses.filter(
    (a) => filterStatus === "all" || a.status === filterStatus,
  );

  const statusConfig = {
    active: {
      color: "bg-green-500/15 text-green-600 border-green-500/30",
      icon: CheckCircle2,
    },
    suspended: {
      color: "bg-orange-500/15 text-orange-600 border-orange-500/30",
      icon: AlertTriangle,
    },
    expired: {
      color: "bg-red-500/15 text-red-600 border-red-500/30",
      icon: XCircle,
    },
    trial: {
      color: "bg-violet-500/15 text-violet-600 border-violet-500/30",
      icon: Timer,
    },
  };

  const getDaysColor = (days: number) => {
    if (days < 0) return "text-red-500";
    if (days <= 30) return "text-orange-500";
    if (days <= 60) return "text-yellow-600";
    return "text-green-600";
  };

  const handleGrant = () => {
    if (!grantForm.tenantId) {
      toast.error("Please select a tenant");
      return;
    }
    const tenant = {
      name:
        accesses.find((t) => t.tenant_id === grantForm.tenantId)?.name ??
        grantForm.tenantId,
    };
    if (!grantForm.isTrial && !grantForm.paidAmount) {
      toast.error("Please enter the amount paid");
      return;
    }

    const now = new Date();
    const expires = new Date(now);
    if (grantForm.isTrial) {
      expires.setDate(expires.getDate() + parseInt(grantForm.trialDays));
    } else {
      expires.setMonth(expires.getMonth() + parseInt(grantForm.durationMonths));
    }

    patchTenant.mutate(
      {
        tenant_id: grantForm.tenantId,
        body: {
          access_level: grantForm.isTrial ? "read" : grantForm.accessLevel,
          status: grantForm.isTrial ? "trial" : "active",
          expires_on: expires.toISOString().split("T")[0],
          paid_amount: grantForm.isTrial
            ? 0
            : parseInt(grantForm.paidAmount || "0"),
        },
      },
      { onSuccess: () => refetch() },
    );

    setGrantOpen(false);

    toast.success(
      grantForm.isTrial
        ? `Trial access granted to ${tenant.name} (${grantForm.trialDays} days)`
        : `Access granted to ${tenant.name}`,
    );

    // Reset form
    setGrantForm({
      tenantId: "",
      plan: "growth",
      accessLevel: "read_write",
      durationMonths: "3",
      paidAmount: "",
      maxUsers: "20",
      storageLimit: "20 GB",
      isTrial: false,
      trialDays: "14",
    });
  };

  const handleRevoke = (access: TenantAccess) => {
    patchTenant.mutate(
      { tenant_id: access.tenant_id, body: { status: "suspended" } },
      {
        onSuccess: () => {
          setRevokeTarget(null);
          toast.success(`Access suspended for ${access.name}`);
        },
        onError: () => toast.error("Failed to suspend access"),
      },
    );
  };

  const handleReactivate = (access: TenantAccess) => {
    patchTenant.mutate(
      { tenant_id: access.tenant_id, body: { status: "active" } },
      {
        onSuccess: () => toast.success(`Access reactivated for ${access.name}`),
        onError: () => toast.error("Failed to reactivate access"),
      },
    );
  };

  const stats = {
    total: accesses.length,
    active: accesses.filter((a) => a.status === "active").length,
    expiringSoon: accesses.filter(
      (a) => a.days_remaining > 0 && a.days_remaining <= 30,
    ).length,
    expired: accesses.filter(
      (a) => a.status === "expired" || a.days_remaining < 0,
    ).length,
    totalRevenue: accesses.reduce((s, a) => s + (a.paid_amount || 0), 0),
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <Breadcrumbs
        items={[
          { label: "DBA Console" },
          { label: "Database" },
          { label: "Control Panel" },
        ]}
      />

      <DbaShell
        title="DB Access Control Panel"
        subtitle="Manage tenant database access, plans & expiry"
        icon={ShieldCheck}
        action={
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setGrantOpen(true)}
          >
            <Plus size={13} /> Grant Access
          </Button>
        }
      >
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Tenants",  value: stats.total,   icon: Building2,    border: "border-l-blue-500",   iconBg: "bg-blue-500/10",   iconColor: "text-blue-500"   },
          { label: "Active",         value: stats.active,  icon: CheckCircle2, border: "border-l-green-500",  iconBg: "bg-green-500/10",  iconColor: "text-green-500"  },
          { label: "Expiring Soon",  value: stats.expiringSoon, icon: AlertTriangle, border: "border-l-orange-500", iconBg: "bg-orange-500/10", iconColor: "text-orange-500" },
          { label: "Expired",        value: stats.expired, icon: XCircle,      border: "border-l-red-500",    iconBg: "bg-red-500/10",    iconColor: "text-red-500"    },
          { label: "Total Revenue",  value: `₹${(stats.totalRevenue / 1000).toFixed(0)}K`, icon: Key, border: "border-l-violet-500", iconBg: "bg-violet-500/10", iconColor: "text-violet-500" },
        ].map((s, i) => (
          <Card key={i} className={`border-l-2 ${s.border}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.iconBg} shrink-0`}>
                <s.icon size={15} className={s.iconColor} />
              </div>
              <div>
                <div className="text-xl font-bold font-heading leading-none">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter + table */}
      <Card>
        <CardHeader className="pb-0 border-b border-border">
          <div className="flex items-center justify-between gap-3 pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-emerald-500/10">
                <Database size={13} className="text-emerald-500" />
              </div>
              Tenant Access Registry
              {filtered.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">
                  {filtered.length}
                </span>
              )}
            </CardTitle>

            {/* Filter pills */}
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border">
              {[
                { key: "all",       label: "All",       dot: "" },
                { key: "active",    label: "Active",    dot: "bg-green-500" },
                { key: "suspended", label: "Suspended", dot: "bg-orange-500" },
                { key: "expired",   label: "Expired",   dot: "bg-red-500" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterStatus(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    filterStatus === f.key
                      ? "bg-background text-foreground shadow-sm border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShieldCheck size={28} className="text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No tenants found</p>
              <p className="text-xs text-muted-foreground/60">Grant access to add your first tenant</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-[11px] font-semibold pl-4">Tenant</TableHead>
                  <TableHead className="text-[11px] font-semibold">Database</TableHead>
                  <TableHead className="text-[11px] font-semibold">Plan</TableHead>
                  <TableHead className="text-[11px] font-semibold">Access</TableHead>
                  <TableHead className="text-[11px] font-semibold">Expires</TableHead>
                  <TableHead className="text-[11px] font-semibold">Days Left</TableHead>
                  <TableHead className="text-[11px] font-semibold">Storage</TableHead>
                  <TableHead className="text-[11px] font-semibold">Status</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((acc) => {
                  const SC = statusConfig[acc.status as keyof typeof statusConfig];
                  const PL = PLAN_CONFIG[acc.plan];
                  const AL = ACCESS_LEVEL_CONFIG[acc.access_level];
                  const storagePercent = Math.round(
                    (parseFloat(acc.storage_used) / parseFloat(acc.storage_limit)) * 100,
                  );

                  return (
                    <TableRow key={acc.tenant_id} className="group text-xs hover:bg-muted/20 transition-colors">
                      <TableCell className="pl-4 py-3">
                        <div className="font-heading font-semibold text-[12px]">{acc.name}</div>
                        <div className="text-muted-foreground font-mono text-[10px] mt-0.5">{acc.tenant_id}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-[11px] font-semibold text-primary">{acc.db_name}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">{acc.server}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <PL.icon size={11} className={PL.color.split(" ")[1]} />
                          <Badge className={`text-[10px] ${PL.color}`}>{PL.label}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${AL.color}`}>{AL.label}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {acc.expires_on}
                      </TableCell>
                      <TableCell>
                        <span className={`font-bold text-[11px] ${getDaysColor(acc.days_remaining)}`}>
                          {acc.days_remaining < 0
                            ? `${Math.abs(acc.days_remaining)}d overdue`
                            : `${acc.days_remaining}d`}
                        </span>
                        {acc.days_remaining > 0 && (
                          <div className="w-16 h-1 bg-muted rounded-full mt-1.5">
                            <div
                              className={`h-1 rounded-full ${acc.days_remaining > 60 ? "bg-green-500" : acc.days_remaining > 30 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min((acc.days_remaining / 365) * 100, 100)}%` }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] text-muted-foreground">
                          {acc.storage_used} / {acc.storage_limit}
                        </div>
                        <div className="w-16 h-1 bg-muted rounded-full mt-1.5">
                          <div
                            className={`h-1 rounded-full ${storagePercent > 80 ? "bg-red-500" : storagePercent > 60 ? "bg-yellow-500" : "bg-emerald-500"}`}
                            style={{ width: `${storagePercent}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge className={`text-[10px] w-fit ${SC.color}`}>{acc.status}</Badge>
                          {acc.is_trial && (
                            <Badge className="text-[9px] bg-violet-500/10 text-violet-600 border-violet-500/20 w-fit">Trial</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg"
                            onClick={() => { setSelectedAccess(acc); setDetailOpen(true); }}>
                            <Eye size={12} />
                          </Button>
                          {acc.status === "active" ? (
                            <Button variant="ghost" size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                              onClick={() => setRevokeTarget(acc)}>
                              <Lock size={12} />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={() => handleReactivate(acc)}>
                              <Unlock size={12} />
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
          )}
        </CardContent>
      </Card>
      </DbaShell>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Database size={15} className="text-emerald-500" />
              Access Details — {selectedAccess?.tenant_id}
            </DialogTitle>
          </DialogHeader>
          {selectedAccess && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Tenant
                  </p>
                  <p className="text-xs font-medium">{selectedAccess.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Database
                  </p>
                  <p className="text-xs font-mono text-primary">
                    {selectedAccess.db_name}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Plan
                  </p>
                  <Badge
                    className={`text-[10px] ${PLAN_CONFIG[selectedAccess.plan].color}`}
                  >
                    {PLAN_CONFIG[selectedAccess.plan].label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Access Level
                  </p>
                  <Badge
                    className={`text-[10px] ${ACCESS_LEVEL_CONFIG[selectedAccess.access_level].color}`}
                  >
                    {ACCESS_LEVEL_CONFIG[selectedAccess.access_level].label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Granted On
                  </p>
                  <p className="text-xs font-mono">
                    {selectedAccess.granted_on}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Expires On
                  </p>
                  <p
                    className={`text-xs font-mono font-bold ${getDaysColor(selectedAccess.days_remaining)}`}
                  >
                    {selectedAccess.expires_on}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Max Users
                  </p>
                  <p className="text-xs">{selectedAccess.max_users} users</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Amount Paid
                  </p>
                  <p className="text-xs font-bold text-green-600">
                    ₹{selectedAccess.paid_amount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Access Duration</span>
                  <span
                    className={`font-bold ${getDaysColor(selectedAccess.days_remaining)}`}
                  >
                    {selectedAccess.days_remaining > 0
                      ? `${selectedAccess.days_remaining} days remaining`
                      : `${Math.abs(selectedAccess.days_remaining)} days overdue`}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${selectedAccess.days_remaining > 60 ? "bg-green-500" : selectedAccess.days_remaining > 30 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{
                      width: `${Math.max(0, Math.min((selectedAccess.days_remaining / 365) * 100, 100))}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Included Features
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(Array.isArray(selectedAccess.features)
                    ? selectedAccess.features
                    : JSON.parse(selectedAccess.features || "[]")
                  ).map((f, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 rounded-full px-2 py-0.5 text-[10px]"
                    >
                      <CheckCircle2 size={9} /> {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDetailOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <div className="p-1.5 rounded-md bg-emerald-500/10">
                <ShieldCheck size={13} className="text-emerald-500" />
              </div>
              Grant DB Access
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Configure database access for a tenant. Paid fields appear after you pick a plan.
            </p>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Step 1 — Tenant */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 text-[10px] font-bold flex items-center justify-center">1</span>
                <Label className="text-xs font-semibold">Select Tenant</Label>
              </div>
              <Select
                value={grantForm.tenantId}
                onValueChange={(v) => setGrantForm((f) => ({ ...f, tenantId: v }))}
              >
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Search or pick a tenant..." />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  {accesses.length === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground">No tenants found</div>
                  ) : accesses.map((t) => (
                    <SelectItem key={t.tenant_id} value={t.tenant_id} className="text-xs">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-[10px]">{t.tenant_id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2 — Plan cards */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 text-[10px] font-bold flex items-center justify-center">2</span>
                <Label className="text-xs font-semibold">Choose Plan</Label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["starter", "growth", "enterprise"] as const).map((plan) => {
                  const cfg = PLAN_CONFIG[plan];
                  const active = grantForm.plan === plan;
                  return (
                    <button
                      key={plan}
                      type="button"
                      onClick={() => setGrantForm((f) => ({ ...f, plan }))}
                      className={`rounded-lg border-2 p-2.5 text-left transition-all ${
                        active
                          ? "border-emerald-500 bg-emerald-500/5"
                          : "border-border bg-muted/20 hover:border-muted-foreground/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <cfg.icon size={11} className={active ? "text-emerald-500" : "text-muted-foreground"} />
                        <span className={`text-[11px] font-semibold ${active ? "text-emerald-600" : "text-foreground"}`}>{cfg.label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{cfg.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3 — Access Level buttons */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 text-[10px] font-bold flex items-center justify-center">3</span>
                <Label className="text-xs font-semibold">Access Level</Label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["read", "read_write", "full"] as const).map((level) => {
                  const cfg = ACCESS_LEVEL_CONFIG[level];
                  const active = grantForm.accessLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setGrantForm((f) => ({ ...f, accessLevel: level }))}
                      className={`rounded-lg border-2 p-2.5 text-left transition-all ${
                        active
                          ? "border-blue-500 bg-blue-500/5"
                          : "border-border bg-muted/20 hover:border-muted-foreground/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <cfg.icon size={11} className={active ? "text-blue-500" : "text-muted-foreground"} />
                        <span className={`text-[11px] font-semibold ${active ? "text-blue-600" : "text-foreground"}`}>{cfg.label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {level === "read" && "View data only"}
                        {level === "read_write" && "Read & modify data"}
                        {level === "full" && "Complete control"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Trial toggle */}
            <div className={`rounded-lg border-2 p-3 transition-all ${grantForm.isTrial ? "border-violet-400/60 bg-violet-500/5" : "border-border bg-muted/20"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Timer size={14} className={grantForm.isTrial ? "text-violet-500" : "text-muted-foreground"} />
                  <div>
                    <p className={`text-xs font-semibold ${grantForm.isTrial ? "text-violet-600" : "text-foreground"}`}>
                      Trial Period Access
                    </p>
                    <p className="text-[10px] text-muted-foreground">Free • Read Only • max 3 users • 1 GB storage</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGrantForm((f) => ({ ...f, isTrial: !f.isTrial, paidAmount: !f.isTrial ? "" : f.paidAmount }))}
                  className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${grantForm.isTrial ? "bg-violet-500" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${grantForm.isTrial ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>

              {grantForm.isTrial && (
                <div className="mt-3 space-y-1">
                  <Label className="text-xs">Trial Duration</Label>
                  <div className="flex gap-2 flex-wrap">
                    {["7", "14", "30", "45", "60"].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGrantForm((f) => ({ ...f, trialDays: d }))}
                        className={`px-3 py-1 rounded-md text-xs border transition-all ${
                          grantForm.trialDays === d
                            ? "border-violet-500 bg-violet-500/10 text-violet-600 font-semibold"
                            : "border-border text-muted-foreground hover:border-muted-foreground/50"
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-violet-500 mt-1 flex items-center gap-1">
                    <Timer size={9} /> Max 60 days • No payment required
                  </p>
                </div>
              )}
            </div>

            {/* Duration + amount — hidden during trial */}
            {!grantForm.isTrial && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Duration</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[["1", "1 mo"], ["3", "3 mo"], ["6", "6 mo"], ["12", "1 yr"]].map(([val, lbl]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setGrantForm((f) => ({ ...f, durationMonths: val }))}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-all ${
                          grantForm.durationMonths === val
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 font-semibold"
                            : "border-border text-muted-foreground hover:border-muted-foreground/50"
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Amount Paid (₹) *</Label>
                  <Input
                    className="text-xs h-9"
                    placeholder={`e.g. ${PLAN_CONFIG[grantForm.plan]?.price.replace(/[^0-9]/g, "")}`}
                    value={grantForm.paidAmount}
                    onChange={(e) => setGrantForm((f) => ({ ...f, paidAmount: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* Features preview */}
            {grantForm.plan && (
              <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Included with {PLAN_CONFIG[grantForm.plan].label}
                </p>
                <div className="flex flex-wrap gap-1">
                  {FEATURES_BY_PLAN[grantForm.plan].map((f, i) => (
                    <span key={i} className="flex items-center gap-1 bg-background border rounded-full px-2 py-0.5 text-[10px]">
                      <CheckCircle2 size={9} className="text-emerald-500" /> {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleGrant}>
              Grant Access
            </Button>
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
            This will immediately suspend <strong>{revokeTarget?.name}</strong>
            's access to{" "}
            <span className="font-mono text-primary">
              {revokeTarget?.db_name}
            </span>
            . You can reactivate later.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs"
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              Suspend Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
