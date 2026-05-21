import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  PAGE_DEFINITIONS,
  type PageKey,
  type PageAction,
  type PagePermission,
} from "@/contexts/AuthContext";
import {
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
} from "@/api/userApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  LayoutDashboard,
  Plus,
  Search,
  Edit3,
  ChevronDown,
  ChevronUp,
  Save,
  X,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
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

// ── Role colour dots ──────────────────────────────────────────────────────────
const ROLE_DOT: Record<string, string> = {
  admin: "bg-blue-500",
  dba: "bg-emerald-500",
  super_admin: "bg-violet-500",
  user: "bg-slate-400",
};

// ── Collapsible permission group (slide-over panel) ───────────────────────────
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
                          id={`wr-${key}-${action}`}
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface DropdownUser {
  id: number;
  name: string;
  role: string;
}

interface UserPermRow {
  userId: number;
  name: string;
  role: string;
  configuredPages: number;
  permissions: PagePermission[];
}

// ── Main component ────────────────────────────────────────────────────────────

function buildWidgetsColumns(
  onManage: (userId: string) => void,
): ColumnDef<UserPermRow, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: "User",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User size={13} className="text-primary" />
          </div>
          <p className="font-semibold text-sm text-foreground truncate leading-tight">
            {row.original.name}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${ROLE_DOT[v] ?? "bg-slate-400"}`}
            />
            <span className="text-[11px] font-heading text-muted-foreground/80">
              {v}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "configuredPages",
      header: "Configured Widgets",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return v > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading border bg-primary/10 text-primary border-primary/20">
            {v} {v !== 1 ? "widgets" : "widget"}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50 italic">
            None configured
          </span>
        );
      },
    },
    {
      id: "manage",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            onClick={() => onManage(String(row.original.userId))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Manage
          </button>
        </div>
      ),
    },
  ];
}
export default function WidgetsRights() {
  // ── Users from DB ─────────────────────────────────────────────────────────
  const [dropdownUsers, setDropdownUsers] = useState<DropdownUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    getUsersForRights()
      .then(setDropdownUsers)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, []);

  // ── Panel state ───────────────────────────────────────────────────────────
  const [showPanel, setShowPanel] = useState(false);
  const [selectedUser, setSelectedUser] = useState<DropdownUser | null>(null);

  const columns = useMemo(
    () =>
      buildWidgetsColumns((userId) => {
        const u = dropdownUsers.find((d) => String(d.id) === String(userId));
        if (u) setSelectedUser(u);
      }),

    [dropdownUsers],
  );
  const [pendingPermissions, setPending] = useState<PagePermission[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // ── Per-user permissions cache for the summary table ─────────────────────
  // Populated lazily when a user is opened; updated after each save.
  const [userPermsCache, setUserPermsCache] = useState<
    Record<number, PagePermission[]>
  >({});

  const tableRows = useMemo<UserPermRow[]>(
    () =>
      dropdownUsers.map((u) => {
        const perms = userPermsCache[u.id] ?? [];
        return {
          userId: u.id,
          name: u.name,
          role: u.role,
          configuredPages: perms.filter((p) => p.actions.length > 0).length,
          permissions: perms,
        };
      }),
    [dropdownUsers, userPermsCache],
  );

  const filteredRows = useMemo(
    () =>
      tableRows.filter((row) => {
        const q = searchTerm.toLowerCase();
        const matchQ =
          !q ||
          row.name.toLowerCase().includes(q) ||
          row.role.toLowerCase().includes(q);
        const matchRole = roleFilter === "all" || row.role === roleFilter;
        return matchQ && matchRole;
      }),
    [tableRows, searchTerm, roleFilter],
  );

  const distinctRoles = useMemo(
    () => [...new Set(dropdownUsers.map((u) => u.role))],
    [dropdownUsers],
  );

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

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalUsers = dropdownUsers.length;
  const usersWithRights = Object.values(userPermsCache).filter((perms) =>
    perms.some((p) => p.actions.length > 0),
  ).length;
  const totalConfigured = Object.values(userPermsCache).reduce(
    (acc, perms) => acc + perms.filter((p) => p.actions.length > 0).length,
    0,
  );

  // ── Permission toggle ─────────────────────────────────────────────────────
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

  // ── Fetch helper ──────────────────────────────────────────────────────────
  const fetchAndSetPerms = useCallback(async (u: DropdownUser) => {
    setPermLoading(true);
    try {
      const perms = await getUserPermissions(u.id);
      setPending(perms.map((p) => ({ page: p.page, actions: [...p.actions] })));
      setUserPermsCache((prev) => ({ ...prev, [u.id]: perms }));
    } catch {
      toast.error("Failed to load permissions");
    } finally {
      setPermLoading(false);
    }
  }, []);

  // ── Open panel ────────────────────────────────────────────────────────────
  const openAssign = useCallback(() => {
    setSelectedUser(null);
    setPending([]);
    setShowPanel(true);
  }, []);

  const openEdit = useCallback(
    (u: DropdownUser) => {
      setSelectedUser(u);
      setPending([]);
      setShowPanel(true);
      fetchAndSetPerms(u);
    },
    [fetchAndSetPerms],
  );

  const closePanel = useCallback(() => {
    setShowPanel(false);
    setSelectedUser(null);
    setPending([]);
  }, []);

  // ── User select inside panel ──────────────────────────────────────────────
  const handlePanelUserSelect = useCallback(
    (rawId: string) => {
      const u = dropdownUsers.find((u) => String(u.id) === rawId);
      if (!u) {
        setSelectedUser(null);
        setPending([]);
        return;
      }
      setSelectedUser(u);
      setPending([]);
      fetchAndSetPerms(u);
    },
    [dropdownUsers, fetchAndSetPerms],
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await saveUserPermissions(selectedUser.id, pendingPermissions);
      setUserPermsCache((prev) => ({
        ...prev,
        [selectedUser.id]: pendingPermissions,
      }));
      toast.success(`Permissions saved for ${selectedUser.name}`);
      closePanel();
    } catch {
      toast.error("Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }, [selectedUser, pendingPermissions, closePanel]);

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Widgets Rights"]} />

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <LayoutDashboard size={16} className="text-primary" />
            </span>
            Widgets Rights
          </h1>
          <p className="text-sm text-muted-foreground mt-1 ml-10">
            Control which users can view and interact with dashboard widgets
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
            label: "Total users",
            value: loadingUsers ? "…" : totalUsers,
            color: "text-primary",
          },
          {
            label: "Users with rights",
            value: usersWithRights,
            color: "text-emerald-500",
          },
          {
            label: "Pages configured",
            value: totalConfigured,
            color: "text-sky-500",
          },
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
            placeholder="Search by name or role…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 text-sm h-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
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

      {/* ── Users table ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
        {loadingUsers ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading users…</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <LayoutDashboard size={36} className="text-muted-foreground/20" />
            <p className="text-sm font-heading font-semibold text-muted-foreground">
              {searchTerm || roleFilter !== "all"
                ? "No matching users"
                : "No users available"}
            </p>
            {!searchTerm && roleFilter === "all" && (
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
            <DataTable
              data={filteredRows}
              columns={columns}
              searchable={false}
              paginated={true}
              defaultPageSize={25}
              emptyMessage="No users found."
            />
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
                    ? `Configuring widget access for ${selectedUser.name}`
                    : "Select a user and configure their widget permissions"}
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
                value={selectedUser ? String(selectedUser.id) : ""}
                onChange={(e) => handlePanelUserSelect(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 cursor-pointer"
              >
                <option value="">Choose a user…</option>
                {dropdownUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
            </div>

            {/* Permissions list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {permLoading ? (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                  <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Loading permissions…
                  </p>
                </div>
              ) : selectedUser ? (
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
                  <LayoutDashboard
                    size={32}
                    className="text-muted-foreground/20"
                  />
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
                  disabled={!selectedUser || saving || permLoading}
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
    </>
  );
}
