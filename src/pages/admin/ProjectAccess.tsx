import React, { useEffect, useMemo, useState } from "react";
import { FolderKanban, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getUsersForRights } from "@/api/userApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface ProjectOpt {
  id: number;
  label: string;
}

export default function ProjectAccess() {
  const rights = usePageRights("project-access");
  const [users, setUsers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingUser, setLoadingUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Promise.all([
      getUsersForRights(),
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([u, p]) => {
        setUsers(u);
        setProjects(Array.isArray(p) ? p : []);
      })
      .catch(() => toast.error("Failed to load users and projects"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (userId == null) return;
    setLoadingUser(true);
    setDirty(false);
    fetchWithAuth(`/api/user-project-access/${userId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSelected(new Set<number>((d.projectIds ?? []).map(Number))))
      .catch(() => {
        toast.error("Failed to load this user's project access");
        setSelected(new Set());
      })
      .finally(() => setLoadingUser(false));
  }, [userId]);

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

  const save = async () => {
    if (userId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/user-project-access/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: [...selected] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      toast.success(selected.size ? `Access limited to ${selected.size} project(s).` : "Restrictions removed — user sees all projects.");
      setDirty(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <>
    <Breadcrumbs items={[{ label: "Admin" }, { label: "Project Access" }]} />
    <AdminShell
      title="Project Access"
      subtitle="Limit which projects a user can see in Material Requests, Purchase Orders, GRNs, Vehicle In/Out, Issues and every project dropdown."
      icon={FolderKanban}
    >
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 max-w-sm">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">User</label>
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
          </div>
          {rights.canEdit && userId != null && (
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

        {userId == null ? (
          <p className="text-sm text-muted-foreground">Pick a user to manage which projects they can see.</p>
        ) : loadingUser ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {selected.size === 0
                ? `${selectedUser?.name ?? "This user"} has no restrictions and sees every project. Tick projects to limit them to only those.`
                : `${selectedUser?.name ?? "This user"} will only see the ${selected.size} ticked project(s).`}
            </p>
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
              {rights.canEdit && (
                <>
                  <button type="button" onClick={() => setAllVisible(true)} className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-muted">
                    Select shown
                  </button>
                  <button type="button" onClick={() => setAllVisible(false)} className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-muted">
                    Clear shown
                  </button>
                </>
              )}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visible.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-muted/40 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={!rights.canEdit}
                    />
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
