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
} from "@/components/layout/ProfileShell";
import { toast } from "sonner";
import {
  User,
  Activity,
  Lock,
  Eye,
  EyeOff,
  Save,
  CheckCircle2,
  ShieldCheck,
  Mail,
  Calendar,
  Loader2,
  Shield,
  Phone,
  MapPin,
} from "lucide-react";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const ADMIN_PERMISSIONS = [
  { label: "User Management", desc: "Create, edit and deactivate users across the org" },
  { label: "Menu Rights", desc: "Grant or revoke page access per user" },
  { label: "Widget Rights", desc: "Control dashboard widget visibility" },
  { label: "Financial Year Rights", desc: "Assign financial year access per user" },
  { label: "Approval Setup", desc: "Configure approval workflows and chains" },
  { label: "Post Approval Rights", desc: "Manage post-approval access controls" },
  { label: "Activity Browser", desc: "View system-wide audit trail" },
  { label: "Security Controls", desc: "Password resets and account lockout management" },
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
    onSuccess: () => { toast.success("Profile updated"); setEditingProfile(false); },
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

  const pwMatch = pw.next && pw.confirm && pw.next === pw.confirm;
  const pwMismatch = pw.next && pw.confirm && pw.next !== pw.confirm;

  const displayName = profile?.name ?? currentUser?.name ?? "Admin";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const memberSince = profile?.created_datetime
    ? new Date(profile.created_datetime).toLocaleDateString("en-IN", {
        day: "numeric", month: "long", year: "numeric",
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
      avatarGradient="from-blue-600 to-blue-400"
      heroAccent="from-blue-600/20 via-blue-400/10 to-transparent"
      roleBadge={
        <span className="text-[10px] font-heading px-2.5 py-0.5 rounded-full border bg-blue-500/10 text-blue-600 border-blue-300/40">
          <ShieldCheck size={9} className="inline mr-1" />
          ADMIN
        </span>
      }
      stats={[
        { label: "Permissions", value: ADMIN_PERMISSIONS.length },
        { label: "Module", value: "Admin" },
        { label: "Status", value: profile?.discontinue ? "Inactive" : "Active" },
      ]}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {/* ── PROFILE TAB ──────────────────────────────────────────────────── */}
      {activeTab === "profile" && (
        <div className="space-y-4">
          {/* Personal Information */}
          <ProfileSection
            title="Personal Information"
            onEdit={editingProfile ? undefined : () => setEditingProfile(true)}
          >
            {!editingProfile ? (
              <ProfileFieldGrid>
                <ProfileField label="Full Name" value={displayName} />
                <ProfileField label="Email Address" value={profile?.email ?? currentUser?.email ?? "—"} />
                <ProfileField label="User Role" value="Administrator" />
                <ProfileField label="Member Since" value={memberSince} />
                <ProfileField label="Status" value={profile?.discontinue ? "Inactive" : "Active"} />
              </ProfileFieldGrid>
            ) : (
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                    Full Name
                  </label>
                  <input value={nameVal} onChange={(e) => setNameVal(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block flex items-center gap-1">
                    <Mail size={10} /> Email (read-only)
                  </label>
                  <input
                    value={profile?.email ?? currentUser?.email ?? ""}
                    disabled
                    className={`${inp} opacity-60 cursor-not-allowed`}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all"
                  >
                    {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
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

          {/* Security */}
          <ProfileSection
            title="Security"
            onEdit={editingPassword ? undefined : () => setEditingPassword(true)}
          >
            {!editingPassword ? (
              <ProfileFieldGrid>
                <ProfileField label="Password" value="••••••••••" />
                <ProfileField label="Two-Factor Auth" value="Not configured" />
                <ProfileField label="Last Login" value={memberSince} />
              </ProfileFieldGrid>
            ) : (
              <div className="space-y-3 max-w-md">
                {(["current", "next", "confirm"] as const).map((field) => (
                  <div key={field}>
                    <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
                      {field === "current" ? "Current Password" : field === "next" ? "New Password" : "Confirm Password"}
                    </label>
                    <div className="relative">
                      <input
                        type={showPw[field] ? "text" : "password"}
                        value={pw[field]}
                        onChange={(e) => setPw((p) => ({ ...p, [field]: e.target.value }))}
                        className={`${inp} pr-10 ${field === "confirm" && pwMismatch ? "border-destructive" : field === "confirm" && pwMatch ? "border-emerald-500" : ""}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((s) => ({ ...s, [field]: !s[field] }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPw[field] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
                {pwMismatch && <p className="text-[11px] text-destructive">Passwords do not match</p>}
                {pwMatch && (
                  <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Passwords match
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => pwMutation.mutate()}
                    disabled={!pw.current || !pwMatch || pwMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all"
                  >
                    {pwMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                    Update Password
                  </button>
                  <button
                    onClick={() => setEditingPassword(false)}
                    className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </ProfileSection>
        </div>
      )}

      {/* ── PERMISSIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "permissions" && (
        <ProfileSection title="Admin Permissions">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ADMIN_PERMISSIONS.map((p) => (
              <div
                key={p.label}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-muted/40 border border-border hover:border-primary/30 transition-colors group"
              >
                <div className="mt-0.5 w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={11} className="text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-heading font-semibold text-foreground group-hover:text-primary transition-colors">
                    {p.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </ProfileSection>
      )}

      {/* ── ACTIVITY TAB ──────────────────────────────────────────────────── */}
      {activeTab === "activity" && (
        <ProfileSection title="Recent Activity">
          {actLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : activity.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No activity recorded yet</div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                    <th className="text-left px-6 py-3 font-heading font-semibold text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">Action</th>
                    <th className="text-left px-4 py-3 font-heading font-semibold text-muted-foreground">Module</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activity.map((log: any, i: number) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
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
            </div>
          )}
        </ProfileSection>
      )}
    </ProfileShell>
  );
}
