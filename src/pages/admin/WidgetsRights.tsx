/**
 * WidgetsRights.tsx
 *
 * Admin page to control which dashboard widgets each user can see.
 * Reads/writes from /api/user-widget-rights (dbo.UserWidgetRights).
 * Completely separate from MenuRights (page/action permissions).
 */

import type React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  BarChart2, TrendingUp, PieChart, Hash, Table2,
  Calendar, Bell, MessageSquare, Map, Paperclip,
  RefreshCw, Calculator, Search, Check,
  Puzzle, ChevronDown, Save, Users, ToggleLeft, ToggleRight,
  AlertCircle,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { getWidgetCatalog, type WidgetCatalogItem } from "@/api/widgetsApi";
import { getRolesList } from "@/api/roleApi";

// ── Widget definitions — must match Widgets.tsx widgetItems exactly ───────────
const widgetIcons: Record<string, React.ElementType> = {
  "bar-chart-2": BarChart2,
  "trending-up": TrendingUp,
  "pie-chart": PieChart,
  hash: Hash,
  "table-2": Table2,
  calendar: Calendar,
  bell: Bell,
  "message-square": MessageSquare,
  map: Map,
  paperclip: Paperclip,
  "refresh-cw": RefreshCw,
  calculator: Calculator,
};

interface UserEntry {
  id: number;
  name: string;
  email: string;
  role: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── API helpers ───────────────────────────────────────────────────────────────
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

async function fetchUsers(): Promise<UserEntry[]> {
  const res = await fetch("/api/user-widget-rights/users", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => ({}));
}

async function fetchUserWidgets(userId: number): Promise<string[]> {
  const res = await fetch(`/api/user-widget-rights/${userId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch widget rights");
  const data = await res.json().catch(() => ({}));
  return data.allowedWidgets ?? [];
}

async function saveUserWidgets(userId: number, allowedWidgets: string[]): Promise<void> {
  const res = await fetch(`/api/user-widget-rights/${userId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ allowedWidgets }),
  });
  if (!res.ok) throw new Error("Failed to save widget rights");
}

async function fetchRoleWidgets(roleId: number): Promise<string[]> {
  const res = await fetch(`/api/user-widget-rights/role/${roleId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch role widget rights");
  const data = await res.json().catch(() => ({}));
  return data.allowedWidgets ?? [];
}

async function saveRoleWidgets(roleId: number, allowedWidgets: string[]): Promise<void> {
  const res = await fetch(`/api/user-widget-rights/role/${roleId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ allowedWidgets }),
  });
  if (!res.ok) throw new Error("Failed to save role widget rights");
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function WidgetsRights() {
  // ── Subject mode: edit a Role's baseline, or a specific user's overrides ────
  type Subject = "user" | "role";
  const [subject, setSubject] = useState<Subject>("user");

  const [users, setUsers] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  const [widgetCatalog, setWidgetCatalog] = useState<WidgetCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [allowedWidgets, setAllowedWidgets] = useState<Set<string>>(new Set());
  const [widgetsLoading, setWidgetsLoading] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState("All");
  const [widgetSearch, setWidgetSearch] = useState("");

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const selectedRole = roles.find((r) => r.RId === selectedRoleId);
  const hasSubjectSelected = subject === "user" ? !!selectedUser : !!selectedRole;

  const switchSubject = useCallback((next: Subject) => {
    setSubject(next);
    setSelectedUser(null);
    setSelectedRoleId(null);
    setAllowedWidgets(new Set());
    setSaveStatus("idle");
  }, []);

  // Load users on mount
  useEffect(() => {
    fetchUsers()
      .then(setUsers)
      .catch(e => setUsersError(e.message))
      .finally(() => setUsersLoading(false));
  }, []);

  // Load roles on mount
  useEffect(() => {
    getRolesList()
      .then(setRoles)
      .catch(() => {})
      .finally(() => setRolesLoading(false));
  }, []);

  useEffect(() => {
    getWidgetCatalog()
      .then(setWidgetCatalog)
      .catch(e => setCatalogError(e.message))
      .finally(() => setCatalogLoading(false));
  }, []);

  // Load widgets when a user is selected (user mode)
  useEffect(() => {
    if (subject !== "user" || !selectedUser) return;
    setWidgetsLoading(true);
    setSaveStatus("idle");
    fetchUserWidgets(selectedUser.id)
      .then(widgets => setAllowedWidgets(new Set(widgets)))
      .catch(() => setAllowedWidgets(new Set()))
      .finally(() => setWidgetsLoading(false));
  }, [subject, selectedUser]);

  // Load widgets when a role is selected (role mode)
  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setWidgetsLoading(true);
    setSaveStatus("idle");
    fetchRoleWidgets(selectedRoleId)
      .then(widgets => setAllowedWidgets(new Set(widgets)))
      .catch(() => setAllowedWidgets(new Set()))
      .finally(() => setWidgetsLoading(false));
  }, [subject, selectedRoleId]);

  const toggleWidget = useCallback((key: string) => {
    setAllowedWidgets(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setSaveStatus("idle");
  }, []);

  const selectAll = () => {
    setAllowedWidgets(new Set(widgetCatalog.map(w => w.key)));
    setSaveStatus("idle");
  };
  const clearAll = () => {
    setAllowedWidgets(new Set());
    setSaveStatus("idle");
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      if (subject === "user") {
        if (!selectedUser) return;
        await saveUserWidgets(selectedUser.id, Array.from(allowedWidgets));
      } else {
        if (!selectedRoleId) return;
        await saveRoleWidgets(selectedRoleId, Array.from(allowedWidgets));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // Filtered users for dropdown
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  const filteredRoles = roles.filter((r) =>
    r.RName.toLowerCase().includes(roleSearch.toLowerCase()),
  );

  // Filtered widgets for display
  const categories = ["All", ...Array.from(new Set(widgetCatalog.map(w => w.category)))];
  const visibleWidgets = widgetCatalog.filter(w => {
    const matchCat = categoryFilter === "All" || w.category === categoryFilter;
    const matchSearch = widgetSearch === "" ||
      w.key.toLowerCase().includes(widgetSearch.toLowerCase()) ||
      w.description.toLowerCase().includes(widgetSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const enabledCount = allowedWidgets.size;

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Widgets Rights"]} />

      <AdminShell
        title="Widgets Rights"
        subtitle="Control which dashboard widgets each user can access. Changes take effect on next login."
        icon={Puzzle}
        action={
          hasSubjectSelected && (
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className={`bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto inline-flex items-center rounded-lg disabled:opacity-60 transition-all
                ${saveStatus === "saved"
                  ? "!bg-none !bg-emerald-500 border border-emerald-500/30"
                  : saveStatus === "error"
                  ? "!bg-none !bg-destructive border border-destructive/30"
                  : ""
                }`}
            >
              {saveStatus === "saving" ? (
                <><RefreshCw size={14} className="animate-spin" /> Saving…</>
              ) : saveStatus === "saved" ? (
                <><Check size={14} /> Saved</>
              ) : saveStatus === "error" ? (
                <><AlertCircle size={14} /> Failed</>
              ) : (
                <><Save size={14} /> Save Changes</>
              )}
            </button>
          )
        }
      >
        {/* Subject selector */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users size={16} className="text-primary" />
              {subject === "user" ? "Select User" : "Select Role"}
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
              <button
                onClick={() => switchSubject("role")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  subject === "role"
                    ? "bg-card shadow text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Role-wise
              </button>
              <button
                onClick={() => switchSubject("user")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  subject === "user"
                    ? "bg-card shadow text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Custom User-wise
              </button>
            </div>
          </div>
          {subject === "role" && (
            <p className="text-xs text-muted-foreground/70">
              Sets the baseline every user with this role sees, effective immediately — a user's own overrides (Custom User-wise) fully replace this for them.
            </p>
          )}

          {subject === "user" ? (
            usersError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={14} /> {usersError}
              </div>
            ) : usersLoading ? (
              <div className="h-10 bg-muted/30 animate-pulse rounded-lg" />
            ) : (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-2 pl-3 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors text-sm appearance-none"
                >
                  <span className={selectedUser ? "text-foreground font-medium" : "text-muted-foreground"}>
                    {selectedUser ? `${selectedUser.name} — ${selectedUser.email}` : "Choose a user to configure…"}
                  </span>
<ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${userDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {userDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          autoFocus
                          value={userSearch}
                          onChange={e => setUserSearch(e.target.value)}
                          placeholder="Search users…"
                          className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 rounded-lg outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredUsers.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
                      ) : (
                        filteredUsers.map(u => (
                          <button
                            key={u.id}
                            onClick={() => { setSelectedUser(u); setUserDropdownOpen(false); setUserSearch(""); }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-accent/10 transition-colors text-left
                              ${selectedUser?.id === u.id ? "bg-primary/10 text-primary" : "text-foreground"}`}
                          >
                            <div>
                              <p className="font-medium">{u.name}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                            <span className="text-xs text-muted-foreground capitalize bg-muted/40 px-2 py-0.5 rounded-full">
                              {u.role}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : rolesLoading ? (
            <div className="h-10 bg-muted/30 animate-pulse rounded-lg" />
          ) : (
            <div className="relative">
              <button
                onClick={() => setRoleDropdownOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 pl-3 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors text-sm appearance-none"
              >
                <span className={selectedRole ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {selectedRole ? selectedRole.RName : "Choose a role to configure…"}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${roleDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {roleDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        value={roleSearch}
                        onChange={e => setRoleSearch(e.target.value)}
                        placeholder="Search roles…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 rounded-lg outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredRoles.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No roles found</p>
                    ) : (
                      filteredRoles.map(r => (
                        <button
                          key={r.RId}
                          onClick={() => { setSelectedRoleId(r.RId); setRoleDropdownOpen(false); setRoleSearch(""); }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-accent/10 transition-colors text-left
                            ${selectedRoleId === r.RId ? "bg-primary/10 text-primary" : "text-foreground"}`}
                        >
                          <p className="font-medium">{r.RName}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {hasSubjectSelected && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <span className="w-2 h-2 rounded-full bg-primary inline-block" />
              Configuring <strong className="text-foreground">{subject === "user" ? selectedUser?.name : selectedRole?.RName}</strong> —
              <strong className="text-foreground">{enabledCount}</strong> of {widgetCatalog.length} widgets enabled
            </div>
          )}
        </div>

        {/* Widget configurator */}
        {hasSubjectSelected && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Toolbar */}
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={widgetSearch}
                  onChange={e => setWidgetSearch(e.target.value)}
                  placeholder="Search widgets…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/20 border border-border rounded-lg outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Category filter */}
              <div className="flex items-center gap-1 flex-wrap">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all whitespace-nowrap
                      ${categoryFilter === cat
                        ? cat === "All"
                          ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-transparent font-semibold shadow-sm"
                          : cat === "Charts"
                            ? "bg-blue-500 text-white border-blue-500 font-semibold"
                            : cat === "KPIs"
                              ? "bg-violet-500 text-white border-violet-500 font-semibold"
                              : cat === "Data"
                                ? "bg-cyan-500 text-white border-cyan-500 font-semibold"
                                : cat === "Planning"
                                  ? "bg-emerald-500 text-white border-emerald-500 font-semibold"
                                  : cat === "Alerts"
                                    ? "bg-rose-500 text-white border-rose-500 font-semibold"
                                    : cat === "Activity"
                                      ? "bg-amber-500 text-white border-amber-500 font-semibold"
                                      : cat === "Geo"
                                        ? "bg-teal-500 text-white border-teal-500 font-semibold"
                                        : cat === "Tools"
                                          ? "bg-orange-500 text-white border-orange-500 font-semibold"
                                          : "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-transparent font-semibold shadow-sm"
                        : cat === "All"
                          ? "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                          : cat === "Charts"
                            ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                            : cat === "KPIs"
                              ? "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                              : cat === "Data"
                                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20"
                                : cat === "Planning"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                                  : cat === "Alerts"
                                    ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                                    : cat === "Activity"
                                      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                                      : cat === "Geo"
                                        ? "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20"
                                        : cat === "Tools"
                                          ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20"
                                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                      }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Bulk actions */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={selectAll}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors font-medium"
                >
                  <ToggleRight size={13} /> Enable all
                </button>
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40 rounded-lg transition-colors"
                >
                  <ToggleLeft size={13} /> Disable all
                </button>
              </div>
            </div>

            {/* Widget grid */}
            {catalogError ? (
              <div className="p-8 text-center text-sm text-destructive">
                {catalogError}
              </div>
            ) : widgetsLoading || catalogLoading ? (
              <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {visibleWidgets.map(widget => {
                  const Icon = widgetIcons[widget.iconKey] || Puzzle;
                  const enabled = allowedWidgets.has(widget.key);
                  return (
                    <button
                      key={widget.key}
                      onClick={() => toggleWidget(widget.key)}
                      className={`relative group flex flex-col items-center gap-2 p-4 rounded-xl border text-left transition-all
                        ${enabled
                          ? "border-primary/50 bg-primary/5 hover:bg-primary/10 shadow-sm"
                          : "border-border bg-muted/10 hover:bg-muted/20 opacity-60 hover:opacity-80"
                        }`}
                    >
                      {/* Enable/disable indicator */}
                      <div className={`absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center transition-all
                        ${enabled ? "bg-primary" : "bg-muted/40 border border-border"}`}
                      >
                        {enabled && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
                      </div>

                      <div className={`p-2 rounded-lg transition-all ${enabled ? "bg-primary/15" : "bg-muted/30"}`}>
                        <Icon size={18} className={enabled ? "text-primary" : "text-muted-foreground"} />
                      </div>
                      <div className="text-center">
                        <p className={`text-xs font-semibold font-heading leading-tight ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
                          {widget.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight hidden sm:block">
                          {widget.category}
                        </p>
                      </div>
                    </button>
                  );
                })}

                {visibleWidgets.length === 0 && (
                  <div className="col-span-full text-center py-10 text-sm text-muted-foreground">
                    No widgets match your search.
                  </div>
                )}
              </div>
            )}

            {/* Footer summary */}
            <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{enabledCount}</span> widgets enabled for{" "}
                <span className="font-semibold text-foreground">
                  {subject === "user" ? selectedUser?.name : selectedRole?.RName}
                </span>
              </p>
              <div className="flex gap-1">
                {widgetCatalog.map(w => (
                  <div
                    key={w.key}
                    title={w.key}
                    className={`w-2 h-2 rounded-full transition-all ${allowedWidgets.has(w.key) ? "bg-primary" : "bg-muted/40"}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasSubjectSelected && !usersLoading && (
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-center">
            <div className="p-4 bg-muted/20 rounded-2xl">
              <Puzzle size={32} className="text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">
              {subject === "user" ? "Select a user to configure their widgets" : "Select a role to configure its baseline widgets"}
            </p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {subject === "user"
                ? "Choose a user from the dropdown above to enable or disable their access to individual dashboard widgets."
                : "Choose a role from the dropdown above to set the baseline widgets every user with that role sees."}
            </p>
          </div>
        )}
      </AdminShell>
    </>
  );
}