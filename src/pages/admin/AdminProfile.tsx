import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  ShieldCheck,
  Mail,
  Loader2,
  Shield,
  Users,
  Settings,
} from "lucide-react";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const ADMIN_PERMISSIONS = [
  {
    label: "User Management",
    desc: "Create, edit and deactivate users across the org",
    icon: Users,
  },
  {
    label: "Menu Rights",
    desc: "Grant or revoke page access per user",
    icon: Settings,
  },
  {
    label: "Widget Rights",
    desc: "Control dashboard widget visibility",
    icon: Settings,
  },
  {
    label: "Financial Year Rights",
    desc: "Assign financial year access per user",
    icon: Shield,
  },
  {
    label: "Approval Setup",
    desc: "Configure approval workflows and chains",
    icon: ShieldCheck,
  },
  {
    label: "Post Approval Rights",
    desc: "Manage post-approval access controls",
    icon: ShieldCheck,
  },
  {
    label: "Activity Browser",
    desc: "View system-wide audit trail",
    icon: Activity,
  },
  {
    label: "Security Controls",
    desc: "Password resets and account lockout management",
    icon: Lock,
  },
];

export default function AdminProfile() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ? parseInt(currentUser.id) : 0;

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

  const { data: activity = [], isLoading: actLoading } = useQuery({
    queryKey: ["user-activity", userId],
    queryFn: () => getUserActivity(userId, 30),
    enabled: activeTab === "activity" && !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: () => updateUserProfile(userId, { name: nameVal }),
    onSuccess: () => {
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

  const displayName = profile?.name ?? currentUser?.name ?? "Admin";
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
    { key: "permissions", label: "Permissions", icon: Shield },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <ProfileShell
      breadcrumbs={["Admin", "My Profile"]}
      initials={initials}
      name={displayName}
      email={profile?.email ?? currentUser?.email ?? ""}
      avatarGradient="linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #06b6d4 100%)"
      heroAccent=""
      heroMesh="radial-gradient(ellipse at 15% 60%, #1e3a5f 0%, transparent 55%), radial-gradient(ellipse at 85% 20%, #0c1e3d 0%, transparent 50%), radial-gradient(ellipse at 50% 90%, #0a192f 0%, transparent 50%), linear-gradient(135deg, #060d1a 0%, #0a1628 50%, #060d1a 100%)"
      accentColor="blue"
      roleBadge={
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-heading font-bold px-2.5 py-1 rounded-full border"
          style={{
            background: "rgba(29,78,216,0.2)",
            borderColor: "rgba(96,165,250,0.3)",
            color: "#93c5fd",
          }}
        >
          <ShieldCheck size={9} />
          ADMIN
        </span>
      }
      stats={[
        { label: "Permissions", value: ADMIN_PERMISSIONS.length },
        { label: "Scope", value: "Admin" },
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
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div
                className="h-16 w-full"
                style={{
                  background: "linear-gradient(135deg, #1e3a5f, #1d4ed8)",
                }}
              />
              <div className="px-4 pb-4 -mt-8">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-heading font-black shadow-lg ring-4 ring-card"
                  style={{
                    background: "linear-gradient(135deg, #1d4ed8, #3b82f6)",
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
                        background: "rgba(29,78,216,0.1)",
                        borderColor: "rgba(96,165,250,0.3)",
                        color: "#60a5fa",
                      }}
                    >
                      Administrator
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
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-heading">
                    Permissions
                  </span>
                  <span className="text-foreground font-bold">
                    {ADMIN_PERMISSIONS.length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Forms */}
          <div className="lg:col-span-2 space-y-4">
            <ProfileSection
              title="Personal Information"
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
                  <ProfileField label="User Role" value="Administrator" />
                  <ProfileField label="Member Since" value={memberSince} />
                  <ProfileField
                    label="Status"
                    value={profile?.discontinue ? "Inactive" : "Active"}
                  />
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
              title="Security"
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
          title="Admin Permissions"
          icon={ShieldCheck}
          subtitle="Organisation-level administrative access"
          headerRight={
            <span
              className="text-[10px] font-heading px-2.5 py-1 rounded-full border"
              style={{
                background: "rgba(29,78,216,0.1)",
                borderColor: "rgba(96,165,250,0.3)",
                color: "#60a5fa",
              }}
            >
              {ADMIN_PERMISSIONS.length} granted
            </span>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ADMIN_PERMISSIONS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.label}
                  className="group flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-blue-400/30 transition-all cursor-default"
                >
                  <div
                    className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(29,78,216,0.12)",
                      border: "1px solid rgba(96,165,250,0.2)",
                    }}
                  >
                    <Icon size={13} className="text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-semibold text-foreground group-hover:text-blue-400 transition-colors">
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
