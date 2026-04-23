import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  getUserActivity,
} from "@/api/userProfileApi";
import {
  ProfileShell,
  ProfileSection,
  ProfileField,
  ProfileFieldGrid,
  PasswordForm,
} from "@/components/layout/ProfileShell";
import { toast } from "sonner";
import {
  User,
  Activity,
  Lock,
  Save,
  Database,
  Loader2,
  Server,
  Terminal,
  Shield,
  HardDrive,
} from "lucide-react";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const DBA_PERMISSIONS = [
  {
    label: "Query Runner",
    desc: "Execute SQL queries against the database",
    icon: Terminal,
  },
  {
    label: "Schema Manager",
    desc: "View and modify table schemas and indexes",
    icon: Database,
  },
  {
    label: "Database Backups",
    desc: "Trigger and monitor database backup jobs",
    icon: HardDrive,
  },
  {
    label: "Tenant DB Access",
    desc: "Access all tenant databases",
    icon: Server,
  },
  {
    label: "Performance Monitor",
    desc: "View query plans and system performance metrics",
    icon: Activity,
  },
  {
    label: "User Lookup",
    desc: "View user data for debugging and support",
    icon: User,
  },
  {
    label: "Audit Log Access",
    desc: "Read full database-level audit trail",
    icon: Shield,
  },
  {
    label: "Control Panel",
    desc: "Access the DBA control panel and diagnostics",
    icon: Terminal,
  },
];

export default function DBAProfile() {
  const { currentUser, updateCurrentUserName } = useAuth();
  const userId = currentUser?.id ? parseInt(currentUser.id) : 0;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("profile");
  const [nameVal, setNameVal] = useState(currentUser?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["user-profile", userId],
    queryFn: () => getUserProfile(userId),
    enabled: !!userId,
  });

  useEffect(() => {
    if (profile?.name) setNameVal(profile.name);
  }, [profile?.name]);

  const { data: activity = [], isLoading: actLoading } = useQuery({
    queryKey: ["user-activity", userId],
    queryFn: () => getUserActivity(userId, 30),
    enabled: activeTab === "activity" && !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: () => updateUserProfile(userId, { name: nameVal }),
    onSuccess: () => {
      updateCurrentUserName(nameVal);
      queryClient.invalidateQueries({ queryKey: ["user-profile", userId] });
      toast.success("Profile updated");
      setEditingProfile(false);
    },
    onError: () => toast.error("Failed to update profile"),
  });

  const pwMutation = useMutation({
    mutationFn: () => changePassword(userId, pw.current, pw.next),
    onSuccess: () => {
      toast.success("Password changed");
      setPw({ current: "", next: "", confirm: "" });
      setEditingPassword(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const displayName = profile?.name ?? currentUser?.name ?? "DBA";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const memberSince = profile?.created_datetime
    ? new Date(profile.created_datetime).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

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
      avatarGradient="linear-gradient(135deg, #065f46 0%, #10b981 50%, #34d399 100%)"
      heroAccent=""
      heroMesh="radial-gradient(ellipse at 20% 40%, #064e3b 0%, transparent 55%), radial-gradient(ellipse at 80% 70%, #022c22 0%, transparent 50%), radial-gradient(ellipse at 50% 10%, #0d2e1f 0%, transparent 50%), linear-gradient(135deg, #020f09 0%, #051a10 50%, #020f09 100%)"
      accentColor="emerald"
      roleBadge={
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-heading font-bold px-2.5 py-1 rounded-full border"
          style={{
            background: "rgba(6,95,70,0.25)",
            borderColor: "rgba(52,211,153,0.3)",
            color: "#6ee7b7",
          }}
        >
          <Database size={9} />
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
      {/* PROFILE TAB */}
      {activeTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Identity card */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div
                className="h-16 w-full"
                style={{
                  background: "linear-gradient(135deg, #022c22, #065f46)",
                }}
              />
              <div className="px-4 pb-4 -mt-8">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-heading font-black shadow-lg ring-4 ring-card"
                  style={{
                    background: "linear-gradient(135deg, #065f46, #10b981)",
                  }}
                >
                  {initials}
                </div>
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-heading font-bold text-foreground">
                    {displayName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {profile?.email ?? currentUser?.email}
                  </p>
                  <div className="pt-1">
                    <span
                      className="text-[10px] font-heading px-2 py-0.5 rounded-full border"
                      style={{
                        background: "rgba(6,95,70,0.15)",
                        borderColor: "rgba(52,211,153,0.25)",
                        color: "#34d399",
                      }}
                    >
                      Database Administrator
                    </span>
                  </div>
                </div>
              </div>
              <div className="border-t border-border px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-heading">
                    Member Since
                  </span>
                  <span className="text-foreground font-medium">
                    {memberSince}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-heading">
                    DB Access
                  </span>
                  <span className="text-emerald-500 font-bold text-[11px]">
                    Full
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-heading">
                    Status
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-heading px-2 py-0.5 rounded-full border ${
                      profile?.discontinue
                        ? "bg-red-500/10 text-red-500 border-red-400/30"
                        : "bg-emerald-500/10 text-emerald-500 border-emerald-400/30"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${profile?.discontinue ? "bg-red-500" : "bg-emerald-500"}`}
                    />
                    {profile?.discontinue ? "Inactive" : "Active"}
                  </span>
                </div>
                {/* DB status block */}
                <div
                  className="mt-3 p-3 rounded-xl border"
                  style={{
                    background: "rgba(6,95,70,0.08)",
                    borderColor: "rgba(52,211,153,0.15)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Server size={11} className="text-emerald-500" />
                    <span className="text-[10px] font-heading font-semibold text-emerald-500">
                      DB Connected
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    SQL Server · Full Access
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Forms */}
          <div className="lg:col-span-2 space-y-4">
            <ProfileSection
              title="Account Information"
              icon={User}
              onEdit={
                editingProfile ? undefined : () => setEditingProfile(true)
              }
            >
              {!editingProfile ? (
                <ProfileFieldGrid>
                  <ProfileField label="Full Name" value={displayName} />
                  <ProfileField
                    label="Email Address"
                    value={profile?.email ?? currentUser?.email ?? "—"}
                  />
                  <ProfileField label="Role" value="Database Administrator" />
                  <ProfileField label="Member Since" value={memberSince} />
                  <ProfileField
                    label="Status"
                    value={profile?.discontinue ? "Inactive" : "Active"}
                  />
                  <ProfileField label="DB Access Level" value="Full" />
                </ProfileFieldGrid>
              ) : (
                <div className="space-y-4 max-w-md">
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
                    <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                      Email (read-only)
                    </label>
                    <input
                      value={profile?.email ?? currentUser?.email ?? ""}
                      disabled
                      className={`${inp} opacity-50 cursor-not-allowed`}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => updateMutation.mutate()}
                      disabled={updateMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
                    >
                      {updateMutation.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Save size={13} />
                      )}
                      Save
                    </button>
                    <button
                      onClick={() => setEditingProfile(false)}
                      className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </ProfileSection>

            <ProfileSection
              title="Change Password"
              icon={Lock}
              onEdit={
                editingPassword ? undefined : () => setEditingPassword(true)
              }
            >
              {!editingPassword ? (
                <ProfileFieldGrid>
                  <ProfileField label="Password" value="••••••••••" />
                  <ProfileField
                    label="Two-Factor Auth"
                    value="Not configured"
                  />
                  <ProfileField label="Last Login" value={memberSince} />
                </ProfileFieldGrid>
              ) : (
                <PasswordForm
                  pw={pw}
                  setPw={setPw}
                  showPw={showPw}
                  setShowPw={setShowPw}
                  isPending={pwMutation.isPending}
                  onSubmit={() => pwMutation.mutate()}
                  onCancel={() => setEditingPassword(false)}
                />
              )}
            </ProfileSection>
          </div>
        </div>
      )}

      {/* PERMISSIONS TAB */}
      {activeTab === "permissions" && (
        <ProfileSection
          title="DBA Permissions"
          icon={Database}
          subtitle="Database-level access and administrative tools"
          headerRight={
            <span
              className="text-[10px] font-heading px-2.5 py-1 rounded-full border"
              style={{
                background: "rgba(6,95,70,0.12)",
                borderColor: "rgba(52,211,153,0.25)",
                color: "#34d399",
              }}
            >
              {DBA_PERMISSIONS.length} granted
            </span>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DBA_PERMISSIONS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.label}
                  className="group flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-emerald-400/30 transition-all cursor-default"
                >
                  <div
                    className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(6,95,70,0.15)",
                      border: "1px solid rgba(52,211,153,0.2)",
                    }}
                  >
                    <Icon size={13} className="text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-semibold text-foreground group-hover:text-emerald-400 transition-colors">
                      {p.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                      {p.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ProfileSection>
      )}

      {/* ACTIVITY TAB */}
      {activeTab === "activity" && (
        <ProfileSection title="Recent Activity" icon={Activity} noPadding>
          {actLoading ? (
            <div className="flex justify-center items-center py-16">
              <Loader2
                size={24}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : activity.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No activity recorded yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
                    Time
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
                    Action
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
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
                    <td className="px-4 py-3 text-foreground">{log.action}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                        {log.module}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ProfileSection>
      )}
    </ProfileShell>
  );
}
