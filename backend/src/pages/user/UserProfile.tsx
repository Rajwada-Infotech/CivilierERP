import React from "react";
import { useState, useEffect } from "react";
import { useAuth, PAGE_DEFINITIONS } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
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
  Key,
  Activity,
  Lock,
  Save,
  Shield,
  Loader2,
  CheckCircle2,
  LayoutGrid,
  Camera,
  Trash2,
  Bell,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

const ACTION_COLORS: Record<string, string> = {
  view: "bg-blue-500/10 text-blue-500 border-blue-400/30",
  create: "bg-emerald-500/10 text-emerald-500 border-emerald-400/30",
  edit: "bg-amber-500/10 text-amber-500 border-amber-400/30",
  delete: "bg-red-500/10 text-red-500 border-red-400/30",
  export: "bg-purple-500/10 text-purple-500 border-purple-400/30",
};

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

export default function UserProfile() {
  usePageRights("user-profile");
  const {
    currentUser,
    canAccessPage,
    canDoAction,
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

  // Sync nameVal when fresh profile arrives from server
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

  // Count from the raw pagePermissions array (populated by backend at login)
  // so that it accurately reflects what the server granted, not just what
  // PAGE_DEFINITIONS happens to enumerate on the frontend.
  const accessiblePages = PAGE_DEFINITIONS.filter((p) =>
    canAccessPage(p.key as any),
  );
  const pageCount =
    currentUser?.pagePermissions?.length ?? accessiblePages.length;
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
    <>
      <ProfileShell
        breadcrumbs={["User", "My Profile"]}
        initials={initials}
        name={displayName}
        email={profile?.email ?? currentUser?.email ?? ""}
        avatarUrl={profile?.avatar_url ?? null}
        onAvatarClick={() => setAvatarModalOpen(true)}
        avatarGradient="linear-gradient(135deg, #374151 0%, #6b7280 50%, #9ca3af 100%)"
        heroAccent=""
        heroMesh="radial-gradient(ellipse at 20% 50%, #1f2937 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, #111827 0%, transparent 50%), radial-gradient(ellipse at 55% 80%, #0f172a 0%, transparent 50%), linear-gradient(135deg, #0a0e16 0%, #111827 50%, #0a0e16 100%)"
        accentColor="slate"
        roleBadge={
          <span className="inline-flex items-center gap-1 text-[10px] font-heading font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
            {profile?.roleName ?? currentUser?.role ?? "user"}
          </span>
        }
        stats={[
          { label: "Pages", value: pageCount },
          {
            label: "Role",
            value: profile?.roleName ?? currentUser?.role ?? "user",
          },
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
                  <div className="flex items-end gap-3">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-heading font-black shadow-lg ring-4 ring-card overflow-hidden shrink-0"
                      style={{
                        background: profile?.avatar_url
                          ? "transparent"
                          : "linear-gradient(135deg, #374151, #6b7280)",
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
                      <span className="text-[10px] font-heading px-2 py-0.5 rounded-full border bg-muted border-border text-muted-foreground">
                        {profile?.roleName ??
                          currentUser?.role ??
                          "Standard User"}
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
                      {pageCount}
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
                      value={profile?.roleName ?? currentUser?.role ?? "user"}
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

        {/* ACCESS TAB */}
        {activeTab === "access" && (
          <ProfileSection
            title="My Page Access"
            icon={LayoutGrid}
            subtitle={`${pageCount} pages available`}
          >
            {pageCount === 0 ? (
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
            ) : accessiblePages.length > 0 ? (
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
            ) : (
              /* pageCount > 0 but none are in PAGE_DEFINITIONS — show raw permission list */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(currentUser?.pagePermissions ?? []).map((perm) => (
                  <div
                    key={perm.page}
                    className="p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/20 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={11} className="text-primary" />
                      </div>
                      <span className="text-xs font-heading font-semibold text-foreground capitalize">
                        {perm.page.replace(/-/g, " ")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(perm.actions ?? []).map((a: string) => (
                        <span
                          key={a}
                          className={`text-[9px] font-heading uppercase tracking-wider px-2 py-0.5 rounded-full border ${ACTION_COLORS[a] ?? "bg-muted text-muted-foreground border-border"}`}
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
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
            {/* Modal header */}
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

            {/* Modal body */}
            <div className="p-5 space-y-4">
              {/* Preview */}
              <div className="flex flex-col items-center gap-3">
                <div
                  className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center text-white text-2xl font-heading font-black shadow-lg"
                  style={{
                    background: avatarPreview
                      ? "transparent"
                      : profile?.avatar_url
                        ? "transparent"
                        : "linear-gradient(135deg, #374151, #6b7280)",
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

              {/* File input (hidden) */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarFileChange}
              />

              {/* Upload button */}
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/40 text-sm font-heading font-semibold text-muted-foreground hover:text-foreground transition-all"
              >
                <Camera size={14} />
                {avatarFile ? avatarFile.name : "Choose image…"}
              </button>

              {/* Action buttons */}
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
