import React, { useEffect, useMemo, useState } from "react";
import { FolderKanban, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getUsersForRights } from "@/api/userApi";
import { getRolesList } from "@/api/roleApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface ProjectOpt {
  id: number;
  label: string;
}

type Mode = "user" | "role";

// Admin-tier roles are never restricted (see backend/services/projectScope.js).
const UNRESTRICTED_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);
const roleKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "_");

interface Inherited {
  roleName: string | null;
  roleProjectIds: number[];
}

export default function ProjectAccess() {
  const rights = usePageRights("project-access");
  const [mode, setMode] = useState<Mode>("user");
  const [users, setUsers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [inherited, setInherited] = useState<Inherited>({ roleName: null, roleProjectIds: [] });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Promise.all([
      getUsersForRights(),
      getRolesList().catch(() => []),
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([u, r, p]) => {
        setUsers(u);
        setRoles(Array.isArray(r) ? r : []);
        setProjects(Array.isArray(p) ? p : []);
      })
      .catch(() => toast.error("Failed to load users, roles and projects"))
      .finally(() => setLoading(false));
  }, []);

  const targetId = mode === "user" ? userId : roleId;

  // Load the chosen user's / role's current list.
  useEffect(() => {
    if (targetId == null) return;
    setLoadingTarget(true);
    setDirty(false);
    const url = mode === "user" ? `/api/user-project-access/${targetId}` : `/api/user-project-access/role/${targetId}`;
    fetchWithAuth(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setSelected(new Set<number>((d.projectIds ?? []).map(Number)));
        setInherited(
          mode === "user"
            ? { roleName: d.roleName ?? null, roleProjectIds: (d.roleProjectIds ?? []).map(Number) }
            : { roleName: null, roleProjectIds: [] },
        );
      })
      .catch(() => {
        toast.error("Failed to load project access");
        setSelected(new Set());
        setInherited({ roleName: null, roleProjectIds: [] });
      })
      .finally(() => setLoadingTarget(false));
  }, [mode, targetId]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setSelected(new Set());
    setInherited({ roleName: null, roleProjectIds: [] });
    setDirty(false);
    setSearch("");
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? projects.filter((p) => p.label.toLowerCase().includes(q)) : projects;
  }, [projects, search]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  };

  const setAllVisible = (on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((p) => (on ? next.add(p.id) : next.delete(p.id)));
      return next;
    });
    setDirty(true);
  };

  const selectedUser = users.find((u) => u.id === userId);
  const selectedRole = roles.find((r) => r.RId === roleId);
  const roleIsAdminTier = mode === "role" && !!selectedRole && UNRESTRICTED_ROLES.has(roleKey(selectedRole.RName));
  const canEditList = rights.canEdit && !roleIsAdminTier;

  const save = async () => {
    if (targetId == null) return;
    setSaving(true);
    try {
      const url = mode === "user" ? `/api/user-project-access/${targetId}` : `/api/user-project-access/role/${targetId}`;
      const res = await fetchWithAuth(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: [...selected] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      if (mode === "user") {
        toast.success(
          selected.size
            ? `Access limited to ${selected.size} project(s).`
            : inherited.roleProjectIds.length
              ? "Personal list removed — this user now follows their role."
              : "Restrictions removed — user sees all projects.",
        );
      } else {
        toast.success(
          selected.size
            ? `Role limited to ${selected.size} project(s).`
            : "Role restriction removed — the role sees all projects.",
        );
      }
      setDirty(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // What the current selection means, in plain words.
  const description = (() => {
    if (mode === "role") {
      const name = selectedRole?.RName ?? "This role";
      if (roleIsAdminTier) return `${name} is an admin role — admins are never restricted, so a list here has no effect.`;
      return selected.size === 0
        ? `Nobody in ${name} is restricted by the role, so they see every project. Tick projects to limit everyone in ${name} to only those (a user with their own list is not affected).`
        : `Everyone in ${name} without a personal list will only see the ${selected.size} ticked project(s).`;
    }
    const name = selectedUser?.name ?? "This user";
    if (selected.size > 0) {
      return inherited.roleProjectIds.length > 0
        ? `${name} will only see the ${selected.size} ticked project(s). This personal list overrides the ${inherited.roleName ?? "role"} role's list.`
        : `${name} will only see the ${selected.size} ticked project(s).`;
    }
    return inherited.roleProjectIds.length > 0
      ? `${name} has no personal list, so follows the ${inherited.roleName ?? "role"} role: ${inherited.roleProjectIds.length} project(s). Tick projects to give ${name} their own list instead.`
      : `${name} has no restrictions and sees every project. Tick projects to limit them to only those.`;
  })();

  const tabCls = (active: boolean) =>
    `h-8 px-4 text-xs font-semibold transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`;

  return (
    <>
    <Breadcrumbs items={[{ label: "Admin" }, { label: "Project Access" }]} />
    <AdminShell
      title="Project Access"
      subtitle="Limit which projects a user — or everyone in a role — can see in Material Requests, Purchase Orders, GRNs, Vehicle In/Out, Issues and every project dropdown."
      icon={FolderKanban}
    >
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button type="button" onClick={() => switchMode("user")} className={tabCls(mode === "user")}>By user</button>
          <button type="button" onClick={() => switchMode("role")} className={tabCls(mode === "role")}>By role</button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 max-w-sm">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{mode === "user" ? "User" : "Role"}</label>
            {mode === "user" ? (
              <select
                value={userId ?? ""}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
                disabled={loading}
                className="w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={roleId ?? ""}
                onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : null)}
                disabled={loading}
                className="w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">Select a role…</option>
                {roles.map((r) => (
                  <option key={r.RId} value={r.RId}>{r.RName}</option>
                ))}
              </select>
            )}
          </div>
          {canEditList && targetId != null && (
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="h-9 inline-flex items-center gap-1.5 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          )}
        </div>

        {targetId == null ? (
          <p className="text-sm text-muted-foreground">
            {mode === "user" ? "Pick a user to manage which projects they can see." : "Pick a role to manage which projects everyone in it can see."}
          </p>
        ) : loadingTarget ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{description}</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[12rem] max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects…"
                  className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-border bg-background text-sm"
                />
              </div>
              {canEditList && (
                <>
                  <button type="button" onClick={() => setAllVisible(true)} className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-muted">
                    Select shown
                  </button>
                  <button type="button" onClick={() => setAllVisible(false)} className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-muted">
                    Clear shown
                  </button>
                  {mode === "user" && selected.size === 0 && inherited.roleProjectIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(new Set(inherited.roleProjectIds));
                        setDirty(true);
                      }}
                      className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-muted"
                    >
                      Start from the role's projects
                    </button>
                  )}
                </>
              )}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visible.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-muted/40 cursor-pointer text-sm">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} disabled={!canEditList} />
                    <span className="truncate">{p.label}</span>
                  </label>
                </li>
              ))}
              {visible.length === 0 && <li className="text-sm text-muted-foreground">No projects match.</li>}
            </ul>
          </>
        )}
      </div>
    </AdminShell>
    </>
  );
}
