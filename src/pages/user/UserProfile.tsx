import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  User,
  Activity,
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  BarChart3,
  Lock,
  Key,
  Save,
  Mail,
  Building2,
  Calendar,
  EyeOff,
} from "lucide-react";
import { useAuth, PAGE_DEFINITIONS } from "@/contexts/AuthContext";
import { toast } from "sonner";

const RECENT_ACTIVITY = [
  { time: "2026-04-03 09:12", action: "Viewed Dashboard", module: "Main", type: "view" },
  { time: "2026-04-03 09:18", action: "Opened Payment page", module: "Finance", type: "view" },
  { time: "2026-04-02 15:44", action: "Created expense booking #EB-0891", module: "Finance", type: "create" },
  { time: "2026-04-02 14:30", action: "Viewed Reports — Q1 Summary", module: "Reports", type: "view" },
  { time: "2026-04-01 11:05", action: "Exported payment list", module: "Finance", type: "export" },
  { time: "2026-03-31 16:00", action: "Updated contractor details", module: "Masters", type: "edit" },
];

const ACTION_COLORS: Record<string, string> = {
  view: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  create: "bg-green-500/15 text-green-600 border-green-500/30",
  edit: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  export: "bg-purple-500/15 text-purple-600 border-purple-500/30",
};

export default function UserProfilePage() {
  const { currentUser, canAccessPage, canDoAction } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "access" | "activity">("profile");
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);

  const accessiblePages = PAGE_DEFINITIONS.filter(p => canAccessPage(p.key as any));

  const tabs = [
    { key: "profile", label: "My Profile", icon: User },
    { key: "access", label: "My Access", icon: Key },
    { key: "activity", label: "Recent Activity", icon: Activity },
  ];

  const stats = [
    { label: "Pages Accessible", value: accessiblePages.length, icon: Eye, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Actions Today", value: RECENT_ACTIVITY.filter(a => a.time.startsWith("2026-04-03")).length, icon: Activity, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "Role", value: currentUser?.role ?? "user", icon: Lock, color: "text-purple-500", bg: "bg-purple-500/10", isText: true },
  ];

  const handleSavePassword = () => {
    if (!passwordForm.current || !passwordForm.next) { toast.error("Fill all fields"); return; }
    if (passwordForm.next !== passwordForm.confirm) { toast.error("Passwords don't match"); return; }
    toast.success("Password changed successfully");
    setPasswordForm({ current: "", next: "", confirm: "" });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["User", "My Profile"]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-lg">
          {currentUser?.initials ?? "U"}
        </div>
        <div>
          <h1 className="text-xl font-bold">{currentUser?.name ?? "User"}</h1>
          <p className="text-sm text-muted-foreground">{currentUser?.email}</p>
        </div>
        <Badge className="ml-auto bg-muted text-muted-foreground border text-xs px-3">
          <User size={10} className="mr-1" /> USER
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon size={18} className={s.color} />
              </div>
              <div>
                <p className={`font-bold ${s.isText ? "text-base capitalize" : "text-2xl"}`}>{s.value}</p>
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

      {/* PROFILE */}
      {activeTab === "profile" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <User size={14} className="text-primary" /> Account Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Full Name</Label>
                <p className="text-sm font-medium">{currentUser?.name}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><Mail size={11} /> Email</Label>
                <p className="text-sm">{currentUser?.email}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><Building2 size={11} /> Role</Label>
                <Badge variant="outline" className="text-xs capitalize">{currentUser?.role}</Badge>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 size={11} /> Status</Label>
                <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs">Active</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lock size={14} className="text-primary" /> Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Current Password", key: "current" },
                { label: "New Password", key: "next" },
                { label: "Confirm Password", key: "confirm" },
              ].map(f => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <div className="relative">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={(passwordForm as any)[f.key]}
                      onChange={e => setPasswordForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="text-xs pr-8"
                    />
                    {f.key === "current" && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPw(!showPw)}
                      >
                        {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {passwordForm.next && passwordForm.confirm && (
                <p className={`text-[11px] ${passwordForm.next === passwordForm.confirm ? "text-green-500" : "text-red-500"}`}>
                  {passwordForm.next === passwordForm.confirm ? "✓ Passwords match" : "✗ Passwords do not match"}
                </p>
              )}
              <Button size="sm" className="w-full h-8 text-xs gap-1 mt-1" onClick={handleSavePassword}>
                <Save size={12} /> Update Password
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ACCESS */}
      {activeTab === "access" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Key size={16} className="text-primary" />
              My Page Permissions
              <Badge className="ml-2 text-[10px]">{accessiblePages.length} pages</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Page</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Permitted Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accessiblePages.map(page => {
                  const perms = currentUser?.pagePermissions?.find(p => p.page === page.key);
                  return (
                    <TableRow key={page.key} className="text-xs">
                      <TableCell className="font-medium">{page.label}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{page.group}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(perms?.actions ?? page.availableActions).map(a => (
                            <Badge key={a} className="text-[9px] bg-primary/10 text-primary border-primary/20 capitalize">{a}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ACTIVITY */}
      {activeTab === "activity" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-primary" /> My Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RECENT_ACTIVITY.map((log, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono text-muted-foreground">{log.time}</TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{log.module}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] capitalize ${ACTION_COLORS[log.type] ?? ""}`}>{log.type}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
