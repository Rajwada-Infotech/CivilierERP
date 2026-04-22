import React, { useState } from "react";
import { useAuth, PAGE_DEFINITIONS } from "@/contexts/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  getUserActivity,
} from "@/api/userProfileApi";
import { ProfileShell } from "@/components/layout/ProfileShell";
import { toast } from "sonner";
import {
  User,
  Key,
  Activity,
  Lock,
  Eye,
  EyeOff,
  Save,
  CheckCircle2,
  Mail,
  Calendar,
  Shield,
  Loader2,
} from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  view: "bg-blue-500/10 text-blue-600 border-blue-400/30",
  create: "bg-emerald-500/10 text-emerald-600 border-emerald-400/30",
  edit: "bg-amber-500/10 text-amber-600 border-amber-400/30",
  delete: "bg-red-500/10 text-red-600 border-red-400/30",
  export: "bg-purple-500/10 text-purple-600 border-purple-400/30",
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

export default function UserProfile() {
  const { currentUser, canAccessPage, canDoAction } = useAuth();
  const userId = currentUser?.id ? parseInt(currentUser.id) : 0;

  const [activeTab, setActiveTab] = useState("profile");
  const [nameVal, setNameVal] = useState(currentUser?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});

  const { data: profile } = useQuery({
    queryKey: ["user-profile", userId],
    queryFn: () => getUserProfile(userId),
    enabled: !!userId,
  });

  const { data: activity = [], isLoading: actLoading } = useQuery({
    queryKey: ["user-activity", userId],
    queryFn: () => getUserActivity(userId, 30),
    enabled: activeTab === "activity" && !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: () => updateUserProfile(userId, { name: nameVal }),
    onSuccess: () => toast.success("Profile updated"),
    onError: () => toast.error("Failed to update profile"),
  });

  const pwMutation = useMutation({
    mutationFn: () => changePassword(userId, pw.current, pw.next),
    onSuccess: () => {
      toast.success("Password changed successfully");
      setPw({ current: "", next: "", confirm: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accessiblePages = PAGE_DEFINITIONS.filter((p) =>
    canAccessPage(p.key as any),
  );
  const pwMatch = pw.next && pw.confirm && pw.next === pw.confirm;
  const pwMismatch = pw.next && pw.confirm && pw.next !== pw.confirm;

  const tabs = [
    { key: "profile", label: "My Profile", icon: User },
    { key: "access", label: "My Access", icon: Key },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  const displayName = profile?.name ?? currentUser?.name ?? "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <ProfileShell
      breadcrumbs={["User", "My Profile"]}
      initials={initials}
      name={displayName}
      email={profile?.email ?? currentUser?.email ?? ""}
      avatarGradient="from-slate-600 to-slate-400"
      heroAccent="from-slate-500/15 via-slate-400/10 to-transparent"
      roleBadge={
        <span className="text-[10px] font-heading px-2.5 py-0.5 rounded-full border bg-muted border-border text-muted-foreground">
          <User size={9} className="inline mr-1" />
          USER
        </span>
      }
      stats={[
        { label: "Pages", value: accessiblePages.length },
        { label: "Role", value: currentUser?.role ?? "user" },
        {
          label: "Status",
          value: profile?.discontinue ? "Inactive" : "Active",
        },
      ]}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {/* ── PROFILE TAB ──────────────────────────────────────────────────── */}
      {activeTab === "profile" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Account info */}
          <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-card/60">
              <User size={14} className="text-primary" />
              <span className="text-sm font-heading font-semibold">
                Account Information
              </span>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                  Full Name
                </label>
                <input
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  className={inp}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Mail size={10} /> Email
                </label>
                <input
                  value={profile?.email ?? currentUser?.email ?? ""}
                  disabled
                  className={`${inp} opacity-60 cursor-not-allowed`}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Calendar size={10} /> Member Since
                </label>
                <p className="text-sm text-foreground">
                  {profile?.created_datetime
                    ? new Date(profile.created_datetime).toLocaleDateString(
                        "en-IN",
                        { day: "numeric", month: "long", year: "numeric" },
                      )
                    : "—"}
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                  Status
                </label>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-heading px-2.5 py-1 rounded-full border ${profile?.discontinue ? "bg-red-500/10 text-red-600 border-red-400/30" : "bg-emerald-500/10 text-emerald-600 border-emerald-400/30"}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${profile?.discontinue ? "bg-red-500" : "bg-emerald-500"}`}
                  />
                  {profile?.discontinue ? "Inactive" : "Active"}
                </span>
              </div>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all"
              >
                {updateMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save Profile
              </button>
            </div>
          </div>

          {/* Change password */}
          <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-card/60">
              <Lock size={14} className="text-primary" />
              <span className="text-sm font-heading font-semibold">
                Change Password
              </span>
            </div>
            <div className="p-5 space-y-3">
              {(["current", "next", "confirm"] as const).map((field) => (
                <div key={field}>
                  <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                    {field === "current"
                      ? "Current Password"
                      : field === "next"
                        ? "New Password"
                        : "Confirm Password"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPw[field] ? "text" : "password"}
                      value={pw[field]}
                      onChange={(e) =>
                        setPw((p) => ({ ...p, [field]: e.target.value }))
                      }
                      className={`${inp} pr-10 ${field === "confirm" && pwMismatch ? "border-destructive" : field === "confirm" && pwMatch ? "border-emerald-500" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPw((s) => ({ ...s, [field]: !s[field] }))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw[field] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              ))}
              {pwMismatch && (
                <p className="text-[11px] text-destructive">
                  Passwords do not match
                </p>
              )}
              {pwMatch && (
                <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Passwords match
                </p>
              )}
              <button
                onClick={() => pwMutation.mutate()}
                disabled={!pw.current || !pwMatch || pwMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all mt-2"
              >
                {pwMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Lock size={14} />
                )}
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ACCESS TAB ───────────────────────────────────────────────────── */}
      {activeTab === "access" && (
        <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div className="flex items-center gap-2">
              <Key size={14} className="text-primary" />
              <span className="text-sm font-heading font-semibold">
                My Page Permissions
              </span>
            </div>
            <span className="text-[10px] font-heading px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {accessiblePages.length} pages
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground">
                    Page
                  </th>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">
                    Group
                  </th>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">
                    Permitted Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accessiblePages.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-5 py-8 text-center text-muted-foreground text-sm"
                    >
                      No page permissions assigned
                    </td>
                  </tr>
                ) : (
                  accessiblePages.map((page) => {
                    const perms = currentUser?.pagePermissions?.find(
                      (p) => p.page === page.key,
                    );
                    const actions = perms?.actions ?? [];
                    return (
                      <tr
                        key={page.key}
                        className="hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-5 py-3 font-medium text-foreground">
                          {page.label}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                            {page.group}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {actions.map((a) => (
                              <span
                                key={a}
                                className="text-[10px] font-heading px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20 capitalize"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ACTIVITY TAB ─────────────────────────────────────────────────── */}
      {activeTab === "activity" && (
        <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-card/60">
            <Activity size={14} className="text-primary" />
            <span className="text-sm font-heading font-semibold">
              Recent Activity
            </span>
          </div>
          {actLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2
                size={24}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : activity.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No activity recorded yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground">
                      Time
                    </th>
                    <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">
                      Action
                    </th>
                    <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">
                      Module
                    </th>
                    <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activity.map((log: any, i: number) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.action_time).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {log.action}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                          {log.module}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] font-heading px-2 py-0.5 rounded-full border capitalize ${ACTION_COLORS[log.action_type] ?? "bg-muted text-muted-foreground border-border"}`}
                        >
                          {log.action_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </ProfileShell>
  );
}
