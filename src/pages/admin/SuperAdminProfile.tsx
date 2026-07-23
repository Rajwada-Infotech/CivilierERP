import React from "react";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserProfile,
  updateUserProfile,
  updateUserPreferences,
  changePassword,
  getUserActivity,
  uploadAvatar,
  removeAvatar,
} from "@/api/userProfileApi";
import { Switch } from "@/components/ui/switch";
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
  Crown,
  Loader2,
  Shield,
  Star,
  Globe,
  Layers,
  Camera,
  Trash2,
  Bell,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const SA_PERMISSIONS = [
  {
    label: "All Admin Permissions",
    desc: "Inherits complete administrator access",
    icon: Shield,
  },
  {
    label: "Tenant Management",
    desc: "Create and manage multi-tenant environments",
    icon: Layers,
  },
  {
    label: "Global Configuration",
    desc: "System-wide settings and platform config",
    icon: Globe,
  },
  {
    label: "Role Architecture",
    desc: "Define and restructure the role hierarchy",
    icon: Star,
  },
  {
    label: "Enterprise Masters",
    desc: "Company, Business Unit and Project management",
    icon: Layers,
  },
  {
    label: "Billing & Subscriptions",
    desc: "Manage tenant billing and plan features",
    icon: Crown,
  },
  {
    label: "DBA Access",
    desc: "Database-level tools and diagnostics",
    icon: Shield,
  },
  {
    label: "Audit Override",
    desc: "View and export full system audit logs",
    icon: Activity,
  },
];

// ─── Activity table columns ───────────────────────────────────────────────────
const ACTIVITY_COLUMNS = [
  {
    accessorKey: "CreatedAt",
    header: "Time",
    accessorFn: (row: any) => row.CreatedAt,
    cell: ({ getValue }: any) => (
      <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {new Date(getValue()).toLocaleString("en-IN")}
      </span>
    ),
  },
  {
    id: "action",
    header: "Action",
    accessorFn: (row: any) => row.ActionType ?? row.EventType ?? "—",
    cell: ({ getValue }: any) => (
      <span className="text-foreground">{getValue()}</span>
    ),
  },
  {
    accessorKey: "Resource",
    header: "Module",
    cell: ({ getValue }: any) => (
      <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
        {(getValue() as string) ?? "—"}
      </span>
    ),
  },
];

export default function SuperAdminProfile() {
  const {
    currentUser,
    updateCurrentUserName,
    updateCurrentUserAvatar,
    updateCurrentUserShowLoginReminders,
  } = useAuth();
  const userId = currentUser?.id ? parseInt(currentUser.id) : 0;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("profile");
  const [nameVal, setNameVal] = useState(currentUser?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

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

  const preferencesMutation = useMutation({
    mutationFn: (showLoginReminders: boolean) =>
      updateUserPreferences(userId, { showLoginReminders }),
    onSuccess: (_data, showLoginReminders) => {
      updateCurrentUserShowLoginReminders(showLoginReminders);
      toast.success(
        showLoginReminders
          ? "Login reminders popup enabled"
          : "Login reminders popup disabled",
      );
    },
    onError: () => toast.error("Failed to update preference"),
  });

  const avatarUploadMutation = useMutation({
    mutationFn: (dataUri: string) => uploadAvatar(userId, dataUri),
    onSuccess: (_data, dataUri) => {
      queryClient.invalidateQueries({ queryKey: ["user-profile", userId] });
      updateCurrentUserAvatar(dataUri);
      toast.success("Avatar updated");
      setAvatarModalOpen(false);
      setAvatarPreview(null);
      setAvatarFile(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const avatarRemoveMutation = useMutation({
    mutationFn: () => removeAvatar(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile", userId] });
      updateCurrentUserAvatar(null);
      toast.success("Avatar removed");
      setAvatarModalOpen(false);
    },
    onError: () => toast.error("Failed to remove avatar"),
  });

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 400 * 1024) {
      toast.error("Image must be under 400 KB");
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAvatarSave = () => {
    if (!avatarPreview) return;
    avatarUploadMutation.mutate(avatarPreview);
  };

  const displayName = profile?.name ?? currentUser?.name ?? "Super Admin";
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
    <>
      <ProfileShell
        breadcrumbs={["Super Admin", "My Profile"]}
        initials={initials}
        name={displayName}
        email={profile?.email ?? currentUser?.email ?? ""}
        avatarUrl={profile?.avatar_url ?? null}
        onAvatarClick={() => setAvatarModalOpen(true)}
        avatarGradient="linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #ec4899 100%)"
        heroAccent=""
        heroMesh="radial-gradient(ellipse at 20% 50%, #3b0764 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #581c87 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, #1e1b4b 0%, transparent 50%), linear-gradient(135deg, #0f0a1e 0%, #1a0f2e 50%, #0d0d1a 100%)"
        accentColor="violet"
        roleBadge={
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-heading font-bold px-2.5 py-1 rounded-full border"
            style={{
              background: "rgba(124,58,237,0.2)",
              borderColor: "rgba(167,139,250,0.3)",
              color: "#c4b5fd",
            }}
          >
            <Crown size={9} />
            SUPER ADMIN
          </span>
        }
        stats={[
          { label: "Permissions", value: SA_PERMISSIONS.length },
          { label: "Scope", value: "Global" },
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
            {/* Left identity card */}
            <div className="lg:col-span-1 space-y-4">
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div
                  className="h-16 w-full"
                  style={{
                    background: "linear-gradient(135deg, #3b0764, #581c87)",
                  }}
                />
                <div className="px-4 pb-4 -mt-8">
                  <div className="flex items-end gap-3">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-heading font-black shadow-lg ring-4 ring-card overflow-hidden shrink-0"
                      style={{
                        background: profile?.avatar_url
                          ? "transparent"
                          : "linear-gradient(135deg, #7c3aed, #a855f7)",
                      }}
                    >
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt={displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        initials
                      )}
                    </div>
                    <button
                      onClick={() => setAvatarModalOpen(true)}
                      className="mb-0.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted hover:bg-muted/80 text-[11px] font-heading font-semibold text-muted-foreground hover:text-foreground transition-all"
                    >
                      <Camera size={11} />
                      Change Photo
                    </button>
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
                          background: "rgba(124,58,237,0.1)",
                          borderColor: "rgba(167,139,250,0.3)",
                          color: "#a78bfa",
                        }}
                      >
                        Super Administrator
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
                      {SA_PERMISSIONS.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right forms */}
            <div className="lg:col-span-2 space-y-4">
              {/* Personal info */}
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
                      value="Super Administrator"
                    />
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

              {/* Security */}
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

              <ProfileSection title="Preferences" icon={Bell}>
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Show reminders popup on login
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pop up pending alerts (from the bell icon) right after you sign in.
                    </p>
                  </div>
                  <Switch
                    checked={currentUser?.showLoginReminders !== false}
                    disabled={preferencesMutation.isPending}
                    onCheckedChange={(checked) =>
                      preferencesMutation.mutate(checked)
                    }
                  />
                </div>
              </ProfileSection>
            </div>
          </div>
        )}

        {/* PERMISSIONS TAB */}
        {activeTab === "permissions" && (
          <ProfileSection
            title="Super Admin Permissions"
            icon={Crown}
            subtitle="Full platform authority — all actions permitted"
            headerRight={
              <span
                className="text-[10px] font-heading px-2.5 py-1 rounded-full border"
                style={{
                  background: "rgba(124,58,237,0.1)",
                  borderColor: "rgba(167,139,250,0.3)",
                  color: "#a78bfa",
                }}
              >
                {SA_PERMISSIONS.length} granted
              </span>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SA_PERMISSIONS.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.label}
                    className="group flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-violet-400/30 transition-all cursor-default"
                  >
                    <div
                      className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: "rgba(124,58,237,0.12)",
                        border: "1px solid rgba(167,139,250,0.2)",
                      }}
                    >
                      <Icon size={13} className="text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-heading font-semibold text-foreground group-hover:text-violet-400 transition-colors">
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
              <DataTable
                data={activity}
                columns={ACTIVITY_COLUMNS}
                searchPlaceholder="Search activity…"
                defaultPageSize={25}
              />
            )}
          </ProfileSection>
        )}
      </ProfileShell>

      {/* ── Avatar Upload Modal ───────────────────────────────────────────── */}
      {avatarModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAvatarModalOpen(false);
              setAvatarPreview(null);
              setAvatarFile(null);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                  <Camera size={13} className="text-muted-foreground" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-foreground">
                  Change Avatar
                </h2>
              </div>
              <button
                onClick={() => {
                  setAvatarModalOpen(false);
                  setAvatarPreview(null);
                  setAvatarFile(null);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center text-white text-2xl font-heading font-black shadow-lg"
                  style={{
                    background: avatarPreview
                      ? "transparent"
                      : profile?.avatar_url
                        ? "transparent"
                        : "linear-gradient(135deg, #7c3aed, #a855f7)",
                  }}
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  JPEG, PNG, WebP or GIF · Max 400 KB
                </p>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarFileChange}
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/40 text-sm font-heading font-semibold text-muted-foreground hover:text-foreground transition-all"
              >
                <Camera size={14} />
                {avatarFile ? avatarFile.name : "Choose image…"}
              </button>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAvatarSave}
                  disabled={!avatarPreview || avatarUploadMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all"
                >
                  {avatarUploadMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  Save Avatar
                </button>
                {profile?.avatar_url && (
                  <button
                    onClick={() => avatarRemoveMutation.mutate()}
                    disabled={avatarRemoveMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/40 text-destructive text-sm font-semibold hover:bg-destructive/10 disabled:opacity-40 transition-all"
                    title="Remove current avatar"
                  >
                    {avatarRemoveMutation.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
