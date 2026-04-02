import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import {
  Crown,
  Mail,
  Shield,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Clock,
  Activity,
  Key,
  Bell,
  Fingerprint,
  Save,
  UserCog,
} from "lucide-react";

const PERMISSIONS = [
  { label: "User Management", desc: "Create, edit and deactivate users" },
  { label: "Menu Rights", desc: "Grant or revoke page access" },
  { label: "Widget Rights", desc: "Control dashboard widget visibility" },
  { label: "Financial Year Rights", desc: "Assign fin-year access per user" },
  { label: "Approval Setup", desc: "Configure approval workflows" },
  { label: "Post Approval Rights", desc: "Manage post-approval access" },
  { label: "API Integration", desc: "Connect and manage external APIs" },
  { label: "Activity Browser", desc: "View full system audit trail" },
  { label: "Security Controls", desc: "Password resets and lockouts" },
  { label: "Enterprise Masters", desc: "Company, BU and Project setup" },
];

export default function SuperAdminProfile() {
  const { currentUser } = useAuth();

  const [profileForm, setProfileForm] = useState({
    name: currentUser?.name ?? "Super Admin",
    email: currentUser?.email ?? "superadmin@civilier.com",
  });

  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [notifications, setNotifications] = useState({
    loginAlerts: true,
    approvalNotifs: true,
    systemUpdates: false,
  });

  const [savedProfile, setSavedProfile] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);

  const handleSaveProfile = () => {
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  const handleSavePassword = () => {
    if (!passwordForm.current || !passwordForm.next || passwordForm.next !== passwordForm.confirm) return;
    setSavedPassword(true);
    setPasswordForm({ current: "", next: "", confirm: "" });
    setTimeout(() => setSavedPassword(false), 2000);
  };

  const passwordMatch = passwordForm.next && passwordForm.confirm && passwordForm.next === passwordForm.confirm;
  const passwordMismatch = passwordForm.next && passwordForm.confirm && passwordForm.next !== passwordForm.confirm;

  return (
    <>
      <Breadcrumbs items={["Admin", "Super Admin Profile"]} />

      <div className="space-y-6 max-w-5xl">
        {/* ── Hero card ──────────────────────────────────────────────────── */}
        <div className="relative rounded-2xl overflow-hidden border border-border bg-card">
          {/* Gradient band */}
          <div className="h-24 bg-gradient-to-r from-violet-600/20 via-primary/10 to-violet-600/5" />

          <div className="px-6 pb-6 -mt-10 flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600 to-violet-400 flex items-center justify-center shadow-lg ring-4 ring-card text-white text-2xl font-heading font-bold select-none">
                {currentUser?.initials ?? "SA"}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center ring-2 ring-card">
                <Crown size={11} className="text-white" />
              </div>
            </div>

            {/* Name + badges */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-heading font-bold text-foreground truncate">
                  {profileForm.name}
                </h1>
                <Badge className="bg-violet-600/15 text-violet-600 border border-violet-300/40 text-[10px] font-heading px-2 py-0.5">
                  <Crown size={9} className="mr-1" /> SUPER ADMIN
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail size={11} /> {profileForm.email}
              </p>
            </div>

            {/* Quick stats */}
            <div className="flex gap-4 text-center pb-1">
              <div>
                <p className="text-lg font-heading font-bold text-foreground">10</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Permissions</p>
              </div>
              <div className="w-px bg-border" />
              <div>
                <p className="text-lg font-heading font-bold text-foreground">All</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Modules</p>
              </div>
              <div className="w-px bg-border" />
              <div>
                <div className="flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-lg font-heading font-bold text-emerald-600">Active</p>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Profile Info ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <UserCog size={15} className="text-primary" /> Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">Full Name</Label>
                <Input value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">Email Address</Label>
                <Input value={profileForm.email} onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">Role</Label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
                  <Crown size={13} className="text-violet-500" />
                  <span className="text-sm font-body text-foreground">Super Administrator</span>
                  <Shield size={12} className="ml-auto text-muted-foreground" />
                </div>
              </div>
              <Button onClick={handleSaveProfile} className="w-full h-9 text-sm gap-2">
                {savedProfile ? <><CheckCircle2 size={14} /> Saved!</> : <><Save size={14} /> Save Profile</>}
              </Button>
            </CardContent>
          </Card>

          {/* ── Change Password ───────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <Key size={15} className="text-primary" /> Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">Current Password</Label>
                <div className="relative">
                  <Input type={showCurrent ? "text" : "password"} value={passwordForm.current} onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))} placeholder="Current password" className="pr-10" />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {/* New */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">New Password</Label>
                <div className="relative">
                  <Input type={showNext ? "text" : "password"} value={passwordForm.next} onChange={(e) => setPasswordForm((p) => ({ ...p, next: e.target.value }))} placeholder="New password" className="pr-10" />
                  <button type="button" onClick={() => setShowNext(!showNext)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showNext ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {/* Confirm */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                    placeholder="Confirm new password"
                    className={`pr-10 ${passwordMismatch ? "border-destructive focus-visible:ring-destructive" : passwordMatch ? "border-emerald-500 focus-visible:ring-emerald-500" : ""}`}
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {passwordMismatch && <p className="text-[11px] text-destructive">Passwords do not match</p>}
                {passwordMatch && <p className="text-[11px] text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} /> Passwords match</p>}
              </div>
              <Button onClick={handleSavePassword} disabled={!passwordForm.current || !passwordMatch} className="w-full h-9 text-sm gap-2">
                {savedPassword ? <><CheckCircle2 size={14} /> Password Updated!</> : <><Lock size={14} /> Update Password</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Permissions ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Shield size={15} className="text-primary" /> System Permissions
              <Badge className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-300/40 font-heading px-2">Full Access</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PERMISSIONS.map((p) => (
                <div key={p.label} className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border hover:border-primary/30 transition-colors group">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={11} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-semibold text-foreground group-hover:text-primary transition-colors">{p.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Notifications + Session ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <Bell size={15} className="text-primary" /> Notification Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "loginAlerts" as const, label: "Login Alerts", desc: "Notify on every login to this account" },
                { key: "approvalNotifs" as const, label: "Approval Notifications", desc: "Receive alerts for pending approvals" },
                { key: "systemUpdates" as const, label: "System Updates", desc: "Get notified about platform updates" },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-heading font-medium text-foreground">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{desc}</p>
                  </div>
                  <Switch
                    checked={notifications[key]}
                    onCheckedChange={(v) => setNotifications((n) => ({ ...n, [key]: v }))}
                    className="data-[state=checked]:bg-primary flex-shrink-0"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <Activity size={15} className="text-primary" /> Session & Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Clock size={14} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-heading font-semibold text-foreground">Current Session</p>
                  <p className="text-[11px] text-muted-foreground">Active · Started today</p>
                </div>
                <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Fingerprint size={14} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-heading font-semibold text-foreground">Two-Factor Auth</p>
                  <p className="text-[11px] text-muted-foreground">Not configured</p>
                </div>
                <Button variant="outline" size="sm" className="ml-auto h-7 px-3 text-[11px] flex-shrink-0">Setup</Button>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                  <Shield size={14} className="text-violet-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-heading font-semibold text-foreground">Account Status</p>
                  <p className="text-[11px] text-muted-foreground">Protected · No restrictions</p>
                </div>
                <Badge className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-300/40 flex-shrink-0">OK</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
