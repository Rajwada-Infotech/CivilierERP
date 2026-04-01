import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, RefreshCw, Search, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

export default function PasswordReset() {
  const { allUsers } = useAuth();
  const [filter, setFilter] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const handleReset = () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    // In a real app, call API here
    toast.success(`Password reset successfully for ${selectedUser?.name}.`);
    setDialogOpen(false);
    setSelectedUser(null);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Security", "Password Reset"]} />
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <Shield size={20} className="text-primary shrink-0" />
              Password Reset
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Manage and reset user passwords from here
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* User cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">No users found.</p>
          )}
          {filtered.map((user) => (
            <Card key={user.id} className="border-border/60">
              <CardContent className="pt-5 pb-4 px-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 shrink-0">
                    <User size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-heading border shrink-0 ${
                      user.isActive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
                        : "bg-destructive/10 text-destructive border-destructive/20"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${user.isActive ? "bg-emerald-500" : "bg-destructive"}`} />
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  onClick={() => openReset({ id: user.id, name: user.name, email: user.email })}
                >
                  <KeyRound size={13} />
                  Reset Password
                </Button>
              </CardContent>
            </Card>
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
              Resetting password for <span className="font-semibold text-foreground">{selectedUser?.name}</span> ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">New Password</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="pr-9"
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
              <Label className="text-xs">Confirm Password</Label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="pr-9"
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
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" className="gradient-accent" onClick={handleReset}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
