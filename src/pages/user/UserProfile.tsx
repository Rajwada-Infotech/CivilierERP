import React, { useState } from "react";
import { useAuth, PAGE_DEFINITIONS } from "@/contexts/AuthContext";
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
  Key,
  Activity,
  Lock,
  Save,
  Mail,
  Shield,
  Loader2,
  CheckCircle2,
  LayoutGrid,
} from "lucide-react";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const ACTION_COLORS: Record<string, string> = {
  view: "bg-blue-500/10 text-blue-500 border-blue-400/30",
  create: "bg-emerald-500/10 text-emerald-500 border-emerald-400/30",
  edit: "bg-amber-500/10 text-amber-500 border-amber-400/30",
  delete: "bg-red-500/10 text-red-500 border-red-400/30",
  export: "bg-purple-500/10 text-purple-500 border-purple-400/30",
};

export default function UserProfile() {
  const { currentUser, canAccessPage, canDoAction } = useAuth();
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

  const accessiblePages = PAGE_DEFINITIONS.filter((p) =>
    canAccessPage(p.key as any),
  );
  const displayName = profile?.name ?? currentUser?.name ?? "User";
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
    { key: "profile", label: "My Profile", icon: User },
    { key: "access", label: "My Access", icon: Key },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <ProfileShell
      breadcrumbs={["User", "My Profile"]}
      initials={initials}
      name={displayName}
      email={profile?.email ?? currentUser?.email ?? ""}
      avatarGradient="linear-gradient(135deg, #374151 0%, #6b7280 50%, #9ca3af 100%)"
      heroAccent=""
      heroMesh="radial-gradient(ellipse at 20% 50%, #1f2937 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, #111827 0%, transparent 50%), radial-gradient(ellipse at 55% 80%, #0f172a 0%, transparent 50%), linear-gradient(135deg, #0a0e16 0%, #111827 50%, #0a0e16 100%)"
      accentColor="slate"
      roleBadge={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-heading font-bold px-2.5 py-1 rounded-full border border-white/20 bg-white/10 text-white/70">
          <User size={9} />
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
      {/* PROFILE TAB */}
      {activeTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Identity card */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div
                className="h-16 w-full"
                style={{
                  background: "linear-gradient(135deg, #1f2937, #374151)",
                }}
              />
              <div className="px-4 pb-4 -mt-8">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-heading font-black shadow-lg ring-4 ring-card"
                  style={{
                    background: "linear-gradient(135deg, #374151, #6b7280)",
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
                    <span className="text-[10px] font-heading px-2 py-0.5 rounded-full border bg-muted border-border text-muted-foreground">
                      Standard User
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
                    Accessible Pages
                  </span>
                  <span className="text-foreground font-bold">
                    {accessiblePages.length}
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
                  <ProfileField
                    label="First Name"
                    value={displayName.split(" ")[0] ?? "—"}
                  />
                  <ProfileField
                    label="Last Name"
                    value={displayName.split(" ").slice(1).join(" ") || "—"}
                  />
                  <ProfileField
                    label="Email Address"
                    value={profile?.email ?? currentUser?.email ?? "—"}
                  />
                  <ProfileField
                    label="User Role"
                    value={currentUser?.role ?? "user"}
                  />
                  <ProfileField label="Member Since" value={memberSince} />
                  <ProfileField label="Phone Number" value="—" />
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
                    label="Account Status"
                    value={
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-heading px-2.5 py-1 rounded-full border ${
                          profile?.discontinue
                            ? "bg-red-500/10 text-red-600 border-red-400/30"
                            : "bg-emerald-500/10 text-emerald-600 border-emerald-400/30"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${profile?.discontinue ? "bg-red-500" : "bg-emerald-500"}`}
                        />
                        {profile?.discontinue ? "Inactive" : "Active"}
                      </span>
                    }
                  />
                  <ProfileField label="Member Since" value={memberSince} />
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

      {/* ACCESS TAB */}
      {activeTab === "access" && (
        <ProfileSection
          title="My Page Access"
          icon={LayoutGrid}
          subtitle={`${accessiblePages.length} pages available`}
        >
          {accessiblePages.length === 0 ? (
            <div className="py-16 text-center">
              <Shield
                size={32}
                className="text-muted-foreground/30 mx-auto mb-3"
              />
              <p className="text-sm text-muted-foreground">
                No pages assigned yet
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Contact your administrator to request access
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {accessiblePages.map((page) => {
                const actions = (
                  ["view", "create", "edit", "delete", "export"] as const
                ).filter((a) => canDoAction(page.key as any, a));
                return (
                  <div
                    key={page.key}
                    className="p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/20 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={11} className="text-primary" />
                      </div>
                      <span className="text-xs font-heading font-semibold text-foreground">
                        {page.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {actions.map((a) => (
                        <span
                          key={a}
                          className={`text-[9px] font-heading uppercase tracking-wider px-2 py-0.5 rounded-full border ${ACTION_COLORS[a] ?? "bg-muted text-muted-foreground border-border"}`}
                        >
                          {a}
                        </span>
                      ))}
                      {actions.length === 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          View only
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
