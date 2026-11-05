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
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell } from "@/components/sheet/Sheet";
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
  const token = sessionStorage.getItem("token");
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
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border whitespace-nowrap ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;
const FIELD = "w-full border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";

export default function WidgetsRights() {
  const rights = usePageRights("widgets-rights");
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

      <SheetShell
        eyebrow="CivilierERP · Admin · Rights"
        title="Widget rights"
        subtitle="Which dashboard widgets a role or a person can use. Changes take effect on next login."
        action={
          hasSubjectSelected && (
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className={`${KEY} h-9 px-5 shrink-0 border ${
                saveStatus === "error" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-foreground text-card border-foreground"
              }`}
            >
              {saveStatus === "saving" ? (
                <><RefreshCw size={14} className="animate-spin" /> Saving…</>
              ) : saveStatus === "saved" ? (
                <><Check size={14} /> Saved</>
              ) : saveStatus === "error" ? (
                <><AlertCircle size={14} /> Failed</>
              ) : (
                <><Save size={13} /> Save changes</>
              )}
            </button>
          )
        }
      >
        {/* Subject selector */}
        <div className="bg-card relative" style={{ border: RULE, zIndex: 40 }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>{subject === "user" ? "Choose a person" : "Choose a role"}</span>
            <div className="inline-flex items-stretch border border-foreground w-fit">
              <button
                onClick={() => switchSubject("role")}
                aria-pressed={subject === "role"}
                className={`h-8 px-3 ${KEY} ${subject === "role" ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}
              >
                Role-wise
              </button>
              <button
                onClick={() => switchSubject("user")}
                aria-pressed={subject === "user"}
                className={`h-8 px-3 border-l border-foreground ${KEY} ${subject === "user" ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}
              >
                Custom user-wise
              </button>
            </div>
          </div>
          <div className="p-4 space-y-3">
          {subject === "role" && (
            <p className="text-xs text-muted-foreground max-w-prose">
              Sets the baseline every user with this role sees, effective immediately — a user's own overrides (Custom User-wise) fully replace this for them.
            </p>
          )}

          {subject === "user" ? (
            usersError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={14} /> {usersError}
              </div>
            ) : usersLoading ? (
              <div className="h-10 bg-muted/30 animate-pulse" />
            ) : (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(o => !o)}
                  className="w-full max-w-md h-10 flex items-center justify-between gap-2 px-3 border border-foreground/40 hover:border-foreground bg-card transition-colors text-sm"
                >
                  <span className={selectedUser ? "text-foreground font-medium" : "text-muted-foreground"}>
                    {selectedUser ? `${selectedUser.name} — ${selectedUser.email}` : "Choose a user to configure…"}
                  </span>
<ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${userDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {userDropdownOpen && (
                  <div className="absolute top-full left-0 w-full max-w-md mt-1 bg-card border border-foreground z-50 overflow-hidden" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
                    <div className="p-2 border-b border-foreground">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          autoFocus
                          value={userSearch}
                          onChange={e => setUserSearch(e.target.value)}
                          placeholder="Search users…"
                          className={`${FIELD} h-8 pl-8 pr-3`}
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
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm border-b border-foreground/10 hover:bg-primary/5 transition-colors text-left text-foreground
                              ${selectedUser?.id === u.id ? "bg-primary/10" : ""}`}
                          >
                            <div>
                              <p className="font-medium">{u.name}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground border border-foreground/30 px-1.5 py-0.5">
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
            <div className="h-10 bg-muted/30 animate-pulse" />
          ) : (
            <div className="relative">
              <button
                onClick={() => setRoleDropdownOpen(o => !o)}
                className="w-full max-w-md h-10 flex items-center justify-between gap-2 px-3 border border-foreground/40 hover:border-foreground bg-card transition-colors text-sm"
              >
                <span className={selectedRole ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {selectedRole ? selectedRole.RName : "Choose a role to configure…"}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${roleDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {roleDropdownOpen && (
                <div className="absolute top-full left-0 w-full max-w-md mt-1 bg-card border border-foreground z-50 overflow-hidden" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
                  <div className="p-2 border-b border-foreground">
                    <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        value={roleSearch}
                        onChange={e => setRoleSearch(e.target.value)}
                        placeholder="Search roles…"
                        className={`${FIELD} h-8 pl-8 pr-3`}
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
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm border-b border-foreground/10 hover:bg-primary/5 transition-colors text-left text-foreground
                            ${selectedRoleId === r.RId ? "bg-primary/10" : ""}`}
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
              Configuring <strong className="text-foreground">{subject === "user" ? selectedUser?.name : selectedRole?.RName}</strong> —
              <strong className="text-foreground">{enabledCount}</strong> of {widgetCatalog.length} widgets enabled
            </div>
          )}
          </div>
        </div>

        {/* Widget configurator */}
        {hasSubjectSelected && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            {/* Toolbar */}
            <div className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              {/* Search */}
              <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={widgetSearch}
                  onChange={e => setWidgetSearch(e.target.value)}
                  placeholder="Search widgets…"
                  className={`${FIELD} h-8 pl-8 pr-3`}
                />
              </div>

              {/* Category filter */}
              <div className="flex items-center gap-1 flex-wrap">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    aria-pressed={categoryFilter === cat}
                    className={chip(categoryFilter === cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Bulk actions */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={selectAll}
                  className={`${KEY} h-7 px-2.5 border border-foreground text-foreground hover:bg-primary/10`}
                >
                  <ToggleRight size={13} /> Enable all
                </button>
                <button
                  onClick={clearAll}
                  className={`${KEY} h-7 px-2.5 border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground`}
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
                  <div key={i} className="h-24 bg-muted/30 animate-pulse" />
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
                      aria-pressed={enabled}
                      className={`relative group flex flex-col items-center gap-2 p-4 border text-left transition-colors
                        ${enabled
                          ? "border-foreground bg-card hover:bg-primary/5"
                          : "border-dashed border-foreground/40 bg-card hover:border-foreground"
                        }`}
                    >
                      {/* Enable/disable indicator */}
                      <div className={`absolute top-2 right-2 w-4 h-4 flex items-center justify-center border transition-colors
                        ${enabled ? "bg-foreground border-foreground" : "border-foreground/40"}`}
                      >
                        {enabled && <Check size={10} className="text-card" strokeWidth={3} />}
                      </div>

                      <div className="p-2">
                        <Icon size={18} className={enabled ? "text-foreground" : "text-muted-foreground"} />
                      </div>
                      <div className="text-center">
                        <p className={`text-xs font-semibold font-heading leading-tight ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
                          {widget.label}
                        </p>
                        <p className={`${LBL} mt-1 leading-tight hidden sm:block`}>
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
            <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderTop: RULE }}>
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
                    className={`w-2 h-2 border transition-colors ${allowedWidgets.has(w.key) ? "bg-foreground border-foreground" : "border-foreground/30"}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasSubjectSelected && !usersLoading && (
          <div className="border border-dashed border-foreground/40 p-10 flex flex-col items-center justify-center gap-2 text-center">
            <p className="font-heading text-base font-bold tracking-tight text-foreground">
              {subject === "user" ? "Select a user to configure their widgets" : "Select a role to configure its baseline widgets"}
            </p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {subject === "user"
                ? "Choose a user from the dropdown above to enable or disable their access to individual dashboard widgets."
                : "Choose a role from the dropdown above to set the baseline widgets every user with that role sees."}
            </p>
          </div>
        )}
      </SheetShell>
    </>
  );
}