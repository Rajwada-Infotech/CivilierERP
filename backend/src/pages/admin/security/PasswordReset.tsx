import React, { useState, useCallback, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Users,
  UserCheck,
  UserX,
  X,
  Lock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { resetUserPassword, getUsers } from "@/api/userApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  super_admin: { bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400", border: "border-purple-400/30" },
  admin:       { bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400",   border: "border-blue-400/30"   },
  dba:         { bg: "bg-emerald-500/15",text: "text-emerald-600 dark:text-emerald-400",border: "border-emerald-400/30"},
  manager:     { bg: "bg-amber-500/15",  text: "text-amber-600 dark:text-amber-400", border: "border-amber-400/30"  },
  director:    { bg: "bg-rose-500/15",   text: "text-rose-600 dark:text-rose-400",   border: "border-rose-400/30"   },
};

const AVATAR_COLORS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-purple-500 to-violet-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-sky-600",
];

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRoleStyle(role: string) {
  return ROLE_COLORS[role] ?? { bg: "bg-slate-500/15", text: "text-slate-600 dark:text-slate-400", border: "border-slate-400/30" };
}

// ─── Password strength ────────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 6)  score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak",   color: "bg-red-500"    };
  if (score <= 2) return { score, label: "Fair",   color: "bg-amber-500"  };
  if (score <= 3) return { score, label: "Good",   color: "bg-blue-500"   };
  return              { score, label: "Strong", color: "bg-emerald-500" };
}

// ─── Reset Dialog ─────────────────────────────────────────────────────────────

function ResetDialog({
  user,
  onClose,
}: {
  user: { id: string; name: string; email: string; role: string } | null;
  onClose: () => void;
}) {
  const [newPassword, setNewPassword]       = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew]               = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [loading, setLoading]               = useState(false);

  // ResetDialog stays mounted across different users (only `user` changes),
  // so without this the previous account's password stays sitting in the
  // fields — both after a successful save and when switching to reset a
  // different account. Reset whenever the target user changes.
  React.useEffect(() => {
    setNewPassword("");
    setConfirmPassword("");
    setShowNew(false);
    setShowConfirm(false);
  }, [user?.id]);

  const strength    = passwordStrength(newPassword);
  const matches     = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch    = confirmPassword && newPassword !== confirmPassword;
  const canSubmit   = newPassword.length >= 6 && matches && !loading;
  const grad        = user ? avatarGradient(user.name) : AVATAR_COLORS[0];
  const initials    = user ? getInitials(user.name) : "?";

  const handleReset = async () => {
    if (!user || !canSubmit) return;
    setLoading(true);
    try {
      await resetUserPassword(Number(user.id), newPassword);
      toast.success(`Password reset for ${user.name}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
      <DialogContent className="p-0 gap-0 overflow-hidden max-w-sm w-[calc(100vw-2rem)]">
        <DialogTitle className="sr-only">Reset Password</DialogTitle>
        <DialogDescription className="sr-only">
          Set a new password for {user?.name}
        </DialogDescription>

        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-blue-500/8 via-transparent to-transparent border-b border-border">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center shrink-0 shadow-sm`}>
              <span className="text-sm font-bold text-white">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
              {user?.role && (
                <span className={`inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${getRoleStyle(user.role).bg} ${getRoleStyle(user.role).text} ${getRoleStyle(user.role).border}`}>
                  {roleLabel(user.role)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Lock size={13} className="text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Set new password</p>
              <p className="text-[11px] text-muted-foreground">Must be at least 6 characters</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* New Password */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoFocus
                className="w-full px-3 py-2.5 pr-9 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/50 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>

            {/* Live length hint — shows as soon as they've typed something
                too short, instead of only failing silently on submit. */}
            {newPassword && newPassword.length < 6 && (
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-500">
                <AlertCircle size={11} />
                {6 - newPassword.length} more character{6 - newPassword.length === 1 ? "" : "s"} needed
              </p>
            )}

            {/* Strength bar */}
            {newPassword && (
              <div className="space-y-1 pt-0.5">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : "bg-muted"}`}
                    />
                  ))}
                </div>
                <p className={`text-[10px] font-medium ${
                  strength.score <= 1 ? "text-red-500" :
                  strength.score <= 2 ? "text-amber-500" :
                  strength.score <= 3 ? "text-blue-500" : "text-emerald-500"
                }`}>
                  {strength.label}
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) handleReset(); }}
                className={`w-full px-3 py-2.5 pr-9 text-sm rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 transition-all ${
                  mismatch
                    ? "border-red-400/60 focus:ring-red-400/20 focus:border-red-400/60"
                    : matches
                    ? "border-emerald-400/60 focus:ring-emerald-400/20 focus:border-emerald-400/60"
                    : "border-border focus:ring-blue-500/25 focus:border-blue-500/50"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>

            {/* Match indicator */}
            {confirmPassword && (
              <div className={`flex items-center gap-1.5 text-[11px] font-medium ${matches ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {matches ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {matches ? "Passwords match" : "Passwords do not match"}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-2.5">
          <button
            onClick={() => { if (!loading) onClose(); }}
            disabled={loading}
            className="w-24 shrink-0 py-2.5 text-sm rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            disabled={!canSubmit}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-heading font-semibold rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${
              canSubmit && !loading ? "animate-breathe" : ""
            }`}
          >
            {loading ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <KeyRound size={13} />
            )}
            {loading ? "Resetting…" : "Reset Password"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── User Card ────────────────────────────────────────────────────────────────

function UserCard({
  user,
  onReset,
}: {
  user: { id: string; name: string; email: string; role: string; isActive: boolean };
  onReset: () => void;
}) {
  const grad     = avatarGradient(user.name);
  const initials = getInitials(user.name);
  const roleStyle = getRoleStyle(user.role);

  return (
    <div className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:border-blue-400/40 hover:shadow-md transition-all duration-200">
      {/* Top accent strip */}
      <div className={`h-0.5 w-full bg-gradient-to-r ${grad}`} />

      <div className="p-5">
        {/* Avatar + status */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center shrink-0 shadow-sm`}>
            <span className="text-sm font-bold text-white">{initials}</span>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 mt-0.5 ${
            user.isActive
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20 dark:text-emerald-400"
              : "bg-red-500/10 text-red-500 border-red-400/20"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-red-500"}`} />
            {user.isActive ? "Active" : "Inactive"}
          </span>
        </div>

        {/* Name / email */}
        <div className="mb-3">
          <p className="font-semibold text-sm text-foreground truncate leading-tight">{user.name}</p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user.email}</p>
        </div>

        {/* Role badge */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border mb-4 ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}>
          {roleLabel(user.role)}
        </span>

        {/* Reset button */}
        <button
          onClick={onReset}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-blue-500/8 hover:border-blue-400/40 hover:text-blue-600 dark:hover:text-blue-400 transition-all group-hover:border-blue-400/30"
        >
          <KeyRound size={12} />
          Reset Password
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PasswordReset() {
  usePageRights("password-reset");
  const { allUsers: contextUsers } = useAuth();
  const [localUsers, setLocalUsers] = useState<typeof contextUsers | null>(null);
  const [refreshing, setRefreshing]  = useState(false);
  const [filter, setFilter]          = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string; name: string; email: string; role: string;
  } | null>(null);

  const allUsers = localUsers ?? contextUsers;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const raw    = await getUsers();
      const mapped = raw.map((u: any) => ({
        id:              String(u.id),
        name:            u.name,
        email:           u.email,
        role:            u.role,
        initials:        u.name?.split(" ").map((w: string) => w[0]).join("").toUpperCase() ?? "?",
        pagePermissions: u.pagePermissions ?? [],
        isActive:        !u.discontinue,
      }));
      setLocalUsers(mapped);
      toast.success(`Loaded ${mapped.length} user${mapped.length !== 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to load users.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const filtered = useMemo(() => {
    let list = [...allUsers];
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allUsers, filter]);

  const activeCount   = allUsers.filter((u) => u.isActive).length;
  const inactiveCount = allUsers.length - activeCount;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Security", "Password Reset"]} />

      <AdminShell
        title="Password Reset"
        subtitle="Search for a user and set a new password on their behalf"
        icon={ShieldCheck}
        action={
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-xl border border-border hover:bg-muted transition-all disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={`transition-transform duration-500 ${refreshing ? "animate-spin" : "group-hover:rotate-180"}`}
            />
            {refreshing ? "Loading…" : "Refresh"}
          </button>
        }
      >

        {/* ── Stats row ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Users,     label: "Total Users",    value: allUsers.length,  color: "text-blue-500",    bg: "bg-blue-500/10"    },
            { icon: UserCheck, label: "Active",         value: activeCount,      color: "text-emerald-500", bg: "bg-emerald-500/10" },
            { icon: UserX,     label: "Inactive",       value: inactiveCount,    color: "text-red-500",     bg: "bg-red-500/10"     },
          ].map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                <Icon size={14} className={color} />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/50 transition-all"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* ── User grid ── */}
        {filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-4 text-center rounded-2xl border border-dashed border-border bg-muted/20">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              {filter
                ? <Search size={22} className="text-muted-foreground/50" />
                : <User size={22} className="text-muted-foreground/50" />
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {filter ? "No users match your search" : "No users loaded yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                {filter
                  ? "Try a different name or email."
                  : "Click Refresh to load the user list from the server."}
              </p>
            </div>
            {!filter && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Loading…" : "Load Users"}
              </button>
            )}
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="text-xs text-blue-500 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  onReset={() => setSelectedUser({ id: user.id, name: user.name, email: user.email, role: user.role })}
                />
              ))}
            </div>
            {filter && (
              <p className="text-xs text-muted-foreground text-center">
                Showing {filtered.length} of {allUsers.length} users
              </p>
            )}
          </>
        )}
      </AdminShell>

      <ResetDialog user={selectedUser} onClose={() => setSelectedUser(null)} />
    </>
  );
}
