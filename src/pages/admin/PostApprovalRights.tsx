import React, { useState, useMemo, useCallback } from "react";
import {
  useAuth,
  PAGE_DEFINITIONS,
  type PageKey,
  type PageAction,
  type PagePermission,
  type AppUser,
} from "@/contexts/AuthContext";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ShieldCheck,
  Plus,
  Search,
  Trash2,
  Edit3,
  UserCheck,
  Eye,
  PlusCircle,
  Edit,
  Trash,
  Printer,
  Download,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Save,
  X,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Action config ─────────────────────────────────────────────────────────────
const ACTION_CONFIG: Partial<
  Record<PageAction, { label: string; color: string }>
> = {
  view: {
    label: "View",
    color: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  },
  create: {
    label: "Add",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  edit: {
    label: "Edit",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  delete: {
    label: "Delete",
    color: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  print: {
    label: "Print",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  export: {
    label: "Export",
    color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  },
  approve: {
    label: "Approve",
    color: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  },
  reject: {
    label: "Reject",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
};

const getActionConfig = (action: string) =>
  ACTION_CONFIG[action as PageAction] ?? {
    label: action.charAt(0).toUpperCase() + action.slice(1),
    color: "bg-muted text-muted-foreground border-border",
  };

interface PermissionRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: AppUser["role"];
  pageKey: PageKey;
  pageLabel: string;
  pageGroup: string;
  actions: string[];
  status: string;
}

// ── Role colour dots ──────────────────────────────────────────────────────────
const ROLE_DOT: Record<string, string> = {
  admin: "bg-blue-500",
  dba: "bg-emerald-500",
  super_admin: "bg-violet-500",
  user: "bg-slate-400",
};

// ── Collapsible group for dialog permissions ──────────────────────────────────
function PermGroup({
  group,
  pages,
  pendingPermissions,
  updatePermission,
}: {
  group: string;
  pages: Array<{ key: PageKey; label: string; actions: PageAction[] }>;
  pendingPermissions: PagePermission[];
  updatePermission: (
    key: PageKey,
    action: PageAction,
    checked: boolean,
  ) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
      >
        <span className="text-xs font-heading font-bold uppercase tracking-widest text-foreground/70">
          {group}
        </span>
        {open ? (
          <ChevronUp size={13} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={13} className="text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="divide-y divide-border/40">
          {pages.map(({ key, label, actions }) => {
            const current =
              pendingPermissions.find((p) => p.page === key)?.actions ?? [];
            return (
              <div
                key={key}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <span className="text-sm text-foreground/80 w-44 shrink-0 truncate">
                  {label}
                </span>
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => {
                    const cfg = getActionConfig(action);
                    const checked = current.includes(action);
                    return (
                      <label
                        key={action}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium cursor-pointer select-none transition-all ${
                          checked
                            ? cfg.color
                            : "bg-transparent border-border/40 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <Checkbox
                          id={`par-${key}-${action}`}
                          checked={checked}
                          onCheckedChange={(v) =>
                            updatePermission(key, action, v as boolean)
                          }
                          className="hidden"
                        />
                        {cfg.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PostApprovalRights() {
  const { allUsers, updateUserPagePermissions, toggleUserStatus, deleteUser } =
    useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [pendingPermissions, setPending] = useState<PagePermission[]>([]);
  const [deletingUserId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userFilter, setUserFilter] = useState<string>("all");

  // ── Derived table data ────────────────────────────────────────────────────
  const tableData = useMemo<PermissionRow[]>(() => {
    const rows: PermissionRow[] = [];
    allUsers.forEach((user) => {
      if (user.role === "super_admin") return;
      PAGE_DEFINITIONS.forEach((def) => {
        const userPerm = user.pagePermissions?.find((p) => p.page === def.key);
        const acts = userPerm?.actions ?? [];
        if (!acts.includes("view")) return;
        rows.push({
          id: `${user.id}-${def.key}`,
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          pageKey: def.key,
          pageLabel: def.label,
          pageGroup: def.group,
          actions: acts,
          status: user.isActive ? "Active" : "Inactive",
        });
      });
    });
    return rows;
  }, [allUsers]);

  const filteredData = useMemo(
    () =>
      tableData.filter((row) => {
        const q = searchTerm.toLowerCase();
        const matchQ =
          !q ||
          row.name.toLowerCase().includes(q) ||
          row.email.toLowerCase().includes(q) ||
          row.pageLabel.toLowerCase().includes(q);
        const matchRole = userFilter === "all" || row.role === userFilter;
        return matchQ && matchRole;
      }),
    [tableData, searchTerm, userFilter],
  );

  // Group rows by user for the table
  const groupedByUser = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    filteredData.forEach((row) => {
      if (!map.has(row.userId)) map.set(row.userId, []);
      map.get(row.userId)!.push(row);
    });
    return map;
  }, [filteredData]);

  const pageGroups = useMemo(() => {
    const groups: Record<
      string,
      Array<{ key: PageKey; label: string; actions: PageAction[] }>
    > = {};
    PAGE_DEFINITIONS.forEach((def) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({
        key: def.key,
        label: def.label,
        actions: def.availableActions ?? [],
      });
    });
    return groups;
  }, []);

  const distinctRoles = useMemo(
    () => [
      ...new Set(
        allUsers.filter((u) => u.role !== "super_admin").map((u) => u.role),
      ),
    ],
    [allUsers],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const updatePermission = useCallback(
    (pageKey: PageKey, action: PageAction, isChecked: boolean) => {
      setPending((prev) => {
        const idx = prev.findIndex((p) => p.page === pageKey);
        const current = idx >= 0 ? [...prev[idx].actions] : [];
        const next = isChecked
          ? current.includes(action)
            ? current
            : [...current, action]
          : current.filter((a) => a !== action);
        const newPerm: PagePermission = { page: pageKey, actions: next };
        if (idx >= 0) {
          const c = [...prev];
          c[idx] = newPerm;
          return c;
        }
        return [...prev, newPerm];
      });
    },
    [],
  );

  const openAssign = useCallback(() => {
    setSelectedUser(null);
    setPending([]);
    setShowPanel(true);
  }, []);

  const openEdit = useCallback((user: AppUser) => {
    setSelectedUser(user);
    setPending(
      (user.pagePermissions ?? []).map((p) => ({
        page: p.page,
        actions: [...p.actions],
      })),
    );
    setShowPanel(true);
  }, []);

  const closePanel = useCallback(() => {
    setShowPanel(false);
    setSelectedUser(null);
    setPending([]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await updateUserPagePermissions(selectedUser.id, pendingPermissions);
      toast.success(`Permissions saved for ${selectedUser.name}`);
      closePanel();
    } catch {
      toast.error("Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }, [selectedUser, pendingPermissions, updateUserPagePermissions, closePanel]);

  const handleToggle = useCallback(
    async (userId: string) => {
      try {
        await toggleUserStatus(userId);
        toast.success("User status updated");
      } catch {
        toast.error("Failed to update status");
      }
    },
    [toggleUserStatus],
  );

  const handleDelete = useCallback(async () => {
    if (!deletingUserId) return;
    try {
      await deleteUser(deletingUserId);
      toast.success("User removed");
    } catch {
      toast.error("Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }, [deletingUserId, deleteUser]);

  const totalPerms = tableData.length;
  const activeUsers = [
    ...new Set(
      tableData.filter((r) => r.status === "Active").map((r) => r.userId),
    ),
  ].length;

  return (
    <>
      <Breadcrumbs items={["Admin", "Approval", "Post Approval Rights"]} />

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <ShieldCheck size={16} className="text-primary" />
            </span>
            Post Approval Rights
          </h1>
          <p className="text-sm text-muted-foreground mt-1 ml-10">
            Control which users can perform actions after approval workflow
            completion
          </p>
        </div>
        <Button
          onClick={openAssign}
          size="sm"
          className="gradient-accent shrink-0 gap-1.5"
        >
          <Plus size={14} />
          Assign Rights
        </Button>
      </div>

      {/* ── Stat pills ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-5">
        {[
          {
            label: "Total permissions",
            value: totalPerms,
            color: "text-primary",
          },
          {
            label: "Users with rights",
            value: groupedByUser.size,
            color: "text-emerald-500",
          },
          { label: "Active users", value: activeUsers, color: "text-sky-500" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-card border border-border/60 shadow-sm"
          >
            <span className={`text-lg font-heading font-bold ${s.color}`}>
              {s.value}
            </span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by name, email or page…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 text-sm h-9"
          />
        </div>
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <SelectValue placeholder="Role filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {distinctRoles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Permissions table grouped by user ─────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
        {groupedByUser.size === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <ShieldCheck size={36} className="text-muted-foreground/20" />
            <p className="text-sm font-heading font-semibold text-muted-foreground">
              {searchTerm
                ? "No matching permissions"
                : "No post-approval rights assigned yet"}
            </p>
            {!searchTerm && (
              <button
                onClick={openAssign}
                className="text-xs text-primary hover:underline mt-1"
              >
                Assign rights to a user →
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-left px-5 py-3 text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground w-56">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground">
                    Page
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground">
                    Permissions
                  </th>
                  <th className="text-center px-4 py-3 text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground w-24">
                    Status
                  </th>
                  <th className="text-right px-5 py-3 text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground w-36">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {[...groupedByUser.entries()].map(([userId, rows]) => {
                  const firstRow = rows[0];
                  const user = allUsers.find((u) => u.id === userId);
                  const isActive = firstRow.status === "Active";

                  return rows.map((row, rowIdx) => (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/20 transition-colors group"
                    >
                      {/* User cell — only on first row of user group */}
                      {rowIdx === 0 ? (
                        <td
                          rowSpan={rows.length}
                          className="px-5 py-3 align-top border-r border-border/30"
                        >
                          <div className="flex items-start gap-2.5 sticky top-0">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                              <User size={13} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-foreground truncate leading-tight">
                                {firstRow.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {firstRow.email}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${ROLE_DOT[firstRow.role] ?? "bg-slate-400"}`}
                                />
                                <span className="text-[10px] font-heading text-muted-foreground/70">
                                  {firstRow.role}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      ) : null}

                      {/* Page */}
                      <td className="px-4 py-2.5">
                        <div>
                          <span className="text-sm text-foreground/90">
                            {row.pageLabel}
                          </span>
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                            {row.pageGroup}
                          </p>
                        </div>
                      </td>

                      {/* Permissions */}
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {row.actions.map((a) => {
                            const cfg = getActionConfig(a);
                            return (
                              <span
                                key={a}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.color}`}
                              >
                                {cfg.label}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* Status — only on first row */}
                      {rowIdx === 0 ? (
                        <td
                          rowSpan={rows.length}
                          className="px-4 py-2.5 text-center align-top"
                        >
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading border ${
                              isActive
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-red-500/10 text-red-400 border-red-500/20"
                            }`}
                          >
                            <span
                              className={`w-1 h-1 rounded-full ${isActive ? "bg-emerald-400" : "bg-red-400"}`}
                            />
                            {firstRow.status}
                          </span>
                        </td>
                      ) : null}

                      {/* Actions — only on first row */}
                      {rowIdx === 0 ? (
                        <td
                          rowSpan={rows.length}
                          className="px-5 py-2.5 text-right align-top"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => user && openEdit(user)}
                              className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                              title="Edit permissions"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={() => handleToggle(userId)}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title={isActive ? "Deactivate" : "Activate"}
                            >
                              <UserCheck size={13} />
                            </button>
                            <button
                              onClick={() => setDeletingId(userId)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                              title="Delete user"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Slide-over permissions panel ──────────────────────────────── */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={closePanel}
          />
          {/* Panel */}
          <div className="w-full max-w-xl bg-card border-l border-border shadow-2xl flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-heading font-bold text-base text-foreground">
                  {selectedUser ? "Edit Permissions" : "Assign Rights"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedUser
                    ? `Configuring access for ${selectedUser.name}`
                    : "Select a user and configure their page permissions"}
                </p>
              </div>
              <button
                onClick={closePanel}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* User selector */}
            <div className="px-6 py-4 border-b border-border/60 shrink-0">
              <Label className="text-xs font-heading font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                User
              </Label>
              <select
                value={selectedUser?.id ?? ""}
                onChange={(e) => {
                  const u = allUsers.find((u) => u.id === e.target.value);
                  if (u) {
                    setSelectedUser(u);
                    setPending(
                      (u.pagePermissions ?? []).map((p) => ({
                        page: p.page,
                        actions: [...p.actions],
                      })),
                    );
                  }
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 cursor-pointer"
              >
                <option value="">Choose a user…</option>
                {allUsers
                  .filter((u) => u.role !== "super_admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.role}
                    </option>
                  ))}
              </select>
            </div>

            {/* Permissions list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {selectedUser ? (
                Object.entries(pageGroups).map(([group, pages]) => (
                  <PermGroup
                    key={group}
                    group={group}
                    pages={pages}
                    pendingPermissions={pendingPermissions}
                    updatePermission={updatePermission}
                  />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
                  <ShieldCheck size={32} className="text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">
                    Select a user above to configure permissions
                  </p>
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {pendingPermissions.filter((p) => p.actions.length > 0).length}{" "}
                pages configured
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={closePanel}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 gradient-accent"
                  onClick={handleSave}
                  disabled={!selectedUser || saving}
                >
                  {saving ? (
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  {saving ? "Saving…" : "Save Permissions"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deletingUserId}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user rights?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user and all their post-approval
              permissions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
