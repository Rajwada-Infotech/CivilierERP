import React, { useState, useCallback, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, RefreshCw, Search, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { resetUserPassword, getUsers } from "@/api/userApi";

// ─── Drawing-sheet ink ──────────────────────────────────────────────────────────

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const TAG = "inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
const INPUT = "w-full h-10 px-3 text-sm bg-card border text-foreground placeholder:text-muted-foreground/60 focus:outline-none transition-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Password strength ────────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= 6)  score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak" };
  if (score <= 2) return { score, label: "Fair" };
  if (score <= 3) return { score, label: "Good" };
  return { score, label: "Strong" };
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
  const weak        = strength.score <= 1;
  const matches     = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch    = confirmPassword && newPassword !== confirmPassword;
  const canSubmit   = newPassword.length >= 6 && matches && !loading;

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
      <DialogContent className="sheet-frame p-0 gap-0 overflow-hidden max-w-sm w-[calc(100vw-2rem)]" style={{ margin: 0 }}>
        <DialogTitle className="sr-only">Reset Password</DialogTitle>
        <DialogDescription className="sr-only">
          Set a new password for {user?.name}
        </DialogDescription>

        {/* Header: whose password */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>Reset password</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="w-11 h-11 border border-foreground flex items-center justify-center shrink-0">
              <span className="font-heading text-sm font-bold text-foreground">{user ? getInitials(user.name) : "?"}</span>
            </div>
            <div className="min-w-0">
              <p className="font-heading text-base font-bold tracking-tight text-foreground truncate">{user?.name}</p>
              <p className="text-[0.6875rem] text-muted-foreground truncate">{user?.email}</p>
              {user?.role && <span className={`${TAG} mt-1 text-foreground border-foreground/40`}>{roleLabel(user.role)}</span>}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* New Password */}
          <div className="space-y-1.5">
            <label className={`${LBL} block`}>New password</label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoFocus
                className={`${INPUT} pr-9 border-foreground/40 focus:border-foreground`}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>

            {/* Live length hint — shows as soon as they've typed something
                too short, instead of only failing silently on submit. */}
            {newPassword && newPassword.length < 6 && (
              <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-foreground">
                <AlertCircle size={11} />
                {6 - newPassword.length} more character{6 - newPassword.length === 1 ? "" : "s"} needed
              </p>
            )}

            {/* Strength: five squares, inked as it gets stronger; red only while weak */}
            {newPassword && (
              <div className="flex items-center gap-2 pt-0.5">
                <div className="flex gap-1 flex-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-2 flex-1 border transition-colors ${
                        i <= strength.score
                          ? weak ? "bg-destructive border-destructive" : "bg-foreground border-foreground"
                          : "border-foreground/30"
                      }`}
                    />
                  ))}
                </div>
                <span className={`${LBL} ${weak ? "!text-destructive" : "!text-foreground"}`}>{strength.label}</span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label className={`${LBL} block`}>Confirm password</label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) handleReset(); }}
                className={`${INPUT} pr-9 ${
                  mismatch ? "border-destructive" : matches ? "border-foreground" : "border-foreground/40 focus:border-foreground"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>

            {/* Match indicator */}
            {confirmPassword && (
              <div className={`flex items-center gap-1.5 text-[0.6875rem] font-medium ${matches ? "text-foreground" : "text-destructive"}`}>
                {matches ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {matches ? "Passwords match" : "Passwords do not match"}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-2" style={{ borderTop: RULE }}>
          <button
            onClick={() => { if (!loading) onClose(); }}
            disabled={loading}
            className={`${KEY_LINE} h-10 w-24 shrink-0`}
          >
            Cancel
          </button>
          <button onClick={handleReset} disabled={!canSubmit} className={`${KEY_INK} h-10 flex-1 whitespace-nowrap`}>
            {loading ? <RefreshCw size={12} className="animate-spin" /> : <KeyRound size={12} />}
            {loading ? "Resetting…" : "Reset password"}
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
  return (
    <div className={`bg-card flex flex-col border ${user.isActive ? "border-foreground" : "border-dashed border-foreground/50"}`}>
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className={`w-10 h-10 border flex items-center justify-center shrink-0 ${user.isActive ? "border-foreground text-foreground" : "border-foreground/40 text-muted-foreground"}`}>
            <span className="font-heading text-sm font-bold">{getInitials(user.name)}</span>
          </div>
          {user.isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>}
        </div>
        <p className={`font-semibold text-sm truncate leading-tight ${user.isActive ? "text-foreground" : "text-muted-foreground"}`}>{user.name}</p>
        <p className="text-[0.6875rem] text-muted-foreground truncate mt-0.5">{user.email}</p>
        <span className={`${TAG} mt-2 text-foreground border-foreground/40`}>{roleLabel(user.role)}</span>
      </div>
      <div className="px-4 py-3 border-t border-foreground/25">
        <button onClick={onReset} className={`${KEY_LINE} w-full h-9`}>
          <KeyRound size={12} />
          Reset password
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

      <SheetShell
        eyebrow="CivilierERP · Admin · Security"
        title="Password reset"
        subtitle="Find a person and set a new password on their behalf."
        action={
          <button onClick={handleRefresh} disabled={refreshing} className={`${KEY_LINE} h-9 px-4`}>
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Loading…" : "Refresh"}
          </button>
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Users", value: allUsers.length, note: "on record" },
              { label: "Active", value: activeCount, note: "can sign in" },
              { label: "Inactive", value: inactiveCount, note: "sign-in blocked" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5 mr-auto">
              <span className={HEAD}>People</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">
                {filter ? `${filtered.length} of ${allUsers.length}` : allUsers.length}
              </span>
            </p>
            <div className="relative w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by name or email…"
                className={`${INPUT} h-9 pl-8 pr-8 border-foreground/40 focus:border-foreground`}
              />
              {filter && (
                <button onClick={() => setFilter("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="p-4">
            {filtered.length === 0 ? (
              <div className="py-14 flex flex-col items-center gap-3 text-center border border-dashed border-foreground/40">
                <p className="font-heading text-base font-bold tracking-tight text-foreground">
                  {filter ? "No one matches that search" : "No users loaded yet"}
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  {filter ? "Try a different name or email." : "Use Load users to fetch the list from the server."}
                </p>
                {filter ? (
                  <button onClick={() => setFilter("")} className={`${KEY_LINE} h-9 px-4`}>Clear search</button>
                ) : (
                  <button onClick={handleRefresh} disabled={refreshing} className={`${KEY_INK} h-9 px-4`}>
                    <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                    {refreshing ? "Loading…" : "Load users"}
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
                {filtered.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onReset={() => setSelectedUser({ id: user.id, name: user.name, email: user.email, role: user.role })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetShell>

      <ResetDialog user={selectedUser} onClose={() => setSelectedUser(null)} />
    </>
  );
}
