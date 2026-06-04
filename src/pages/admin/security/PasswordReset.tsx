import React, { useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Search,
  Shield,
  User,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { resetUserPassword, getUsers } from "@/api/userApi";

export default function PasswordReset() {
  const { allUsers: contextUsers } = useAuth();
  const [localUsers, setLocalUsers] = useState<typeof contextUsers | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  // Prefer locally-refreshed list, fallback to context
  const allUsers = localUsers ?? contextUsers;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const raw = await getUsers();
      const mapped = raw.map((u: any) => ({
        id: String(u.id),
        name: u.name,
        email: u.email,
        role: u.role,
        initials:
          u.name
            ?.split(" ")
            .map((w: string) => w[0])
            .join("")
            .toUpperCase() ?? "?",
        pagePermissions: u.pagePermissions ?? [],
        isActive: !u.discontinue,
      }));
      setLocalUsers(mapped);
      if (mapped.length === 0) toast.info("No users found in the system.");
      else
        toast.success(
          `Loaded ${mapped.length} user${mapped.length !== 1 ? "s" : ""}.`,
        );
    } catch (err: any) {
      toast.error(
        err.message || "Failed to load users. Check your permissions.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);
  const [filter, setFilter] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const filtered = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase()),
  );

  const openReset = (u: { id: string; name: string; email: string }) => {
    setSelectedUser(u);
    setNewPassword("");
    setConfirmPassword("");
    setDialogOpen(true);
  };

  const handleReset = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (!selectedUser) return;
    setLoading(true);
    try {
      await resetUserPassword(Number(selectedUser.id), newPassword);
      toast.success(`Password reset successfully for ${selectedUser.name}.`);
      setDialogOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Admin", "Security", "Password Reset"]}
      />
      <div className="relative space-y-6 mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-semibold text-foreground">
                Password Reset
              </h1>
              <p className="text-xs text-muted-foreground">
                Manage and reset user passwords from here
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Loading…" : "Refresh"}
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            placeholder="Search by name or email..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* User cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 && (
            <div className="col-span-full py-12 flex flex-col items-center gap-3 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                <AlertCircle size={20} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {filter ? "No users match your search." : "No users loaded."}
                </p>
                {!filter && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This can happen if your role lacks the Users list permission
                    in RoleRights.
                  </p>
                )}
              </div>
              {!filter && (
                <button
                  className="flex items-center gap-2 px-4 py-2 mt-1 text-xs font-semibold rounded-lg border border-border hover:bg-muted transition-colors"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw
                    size={13}
                    className={refreshing ? "animate-spin" : ""}
                  />
                  {refreshing ? "Loading…" : "Try loading users"}
                </button>
              )}
            </div>
          )}
          {filtered.map((user) => (
            <div key={user.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="pt-5 pb-4 px-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 shrink-0">
                    <User size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground truncate">
                      {user.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-heading border shrink-0 ${
                      user.isActive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
                        : "bg-destructive/10 text-destructive border-destructive/20"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full mr-1 ${user.isActive ? "bg-emerald-500" : "bg-destructive"}`}
                    />
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <button
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted transition-colors"
                  onClick={() =>
                    openReset({
                      id: user.id,
                      name: user.name,
                      email: user.email,
                    })
                  }
                >
                  <KeyRound size={13} />
                  Reset Password
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              <RefreshCw size={16} className="text-primary" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Resetting password for{" "}
              <span className="font-semibold text-foreground">
                {selectedUser?.name}
              </span>{" "}
              ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full px-3 py-2 pr-9 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2 pr-9 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              onClick={() => setDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="gradient-accent font-semibold text-white text-sm px-5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleReset}
              disabled={loading}
            >
              {loading ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <KeyRound size={13} />
              )}
              {loading ? "Resetting…" : "Reset Password"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}