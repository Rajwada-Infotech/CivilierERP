import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
  Database,
  Mail,
  Calendar,
  Loader2,
  Server,
  Terminal,
  Shield,
} from "lucide-react";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const DBA_PERMISSIONS = [
  { label: "Query Runner", desc: "Execute SQL queries against the database" },
  {
    label: "Schema Manager",
    desc: "View and modify table schemas and indexes",
  },
  {
    label: "Database Backups",
    desc: "Trigger and monitor database backup jobs",
  },
  { label: "Tenant DB Access", desc: "Access all tenant databases" },
  {
    label: "Performance Monitor",
    desc: "View query plans and system performance metrics",
  },
  { label: "User Lookup", desc: "View user data for debugging and support" },
  { label: "Audit Log Access", desc: "Read full database-level audit trail" },
  {
    label: "Control Panel",
    desc: "Access the DBA control panel and diagnostics",
  },
];

export default function DBAProfile() {
  const { currentUser } = useAuth();
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
      toast.success("Password changed");
      setPw({ current: "", next: "", confirm: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pwMatch = pw.next && pw.confirm && pw.next === pw.confirm;
  const pwMismatch = pw.next && pw.confirm && pw.next !== pw.confirm;

  const displayName = profile?.name ?? currentUser?.name ?? "DBA";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const tabs = [
    { key: "profile", label: "Profile", icon: User },
    { key: "permissions", label: "Permissions", icon: Database },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <ProfileShell
      breadcrumbs={["DBA", "My Profile"]}
      initials={initials}
      name={displayName}
      email={profile?.email ?? currentUser?.email ?? ""}
      avatarGradient="from-emerald-600 to-emerald-400"
      heroAccent="from-emerald-600/20 via-emerald-400/10 to-transparent"
      roleBadge={
        <span className="text-[10px] font-heading px-2.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 border-emerald-300/40">
          <Database size={9} className="inline mr-1" />
          DBA
        </span>
      }
      stats={[
        { label: "DB Access", value: "Full" },
        { label: "Permissions", value: DBA_PERMISSIONS.length },
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
                  Role
                </label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-300/30">
                  <Database size={13} className="text-emerald-500" />
                  <span className="text-sm font-body text-foreground">
                    Database Administrator
                  </span>
                  <Server size={11} className="ml-auto text-emerald-400" />
                </div>
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

      {/* ── PERMISSIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "permissions" && (
        <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div className="flex items-center gap-2">
              <Database size={14} className="text-emerald-500" />
              <span className="text-sm font-heading font-semibold">
                DBA Permissions
              </span>
            </div>
            <span className="text-[10px] font-heading px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-300/40">
              DB Level Access
            </span>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DBA_PERMISSIONS.map((p) => (
              <div
                key={p.label}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-muted/40 border border-border hover:border-emerald-300/50 transition-colors group"
              >
                <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Terminal size={10} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-heading font-semibold text-foreground group-hover:text-emerald-600 transition-colors">
                    {p.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              </div>
            ))}
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
