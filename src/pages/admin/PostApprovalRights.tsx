import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Search,
  Save,
  ChevronDown,
  Check,
  Users,
  Loader2,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { toast } from "sonner";
import {
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
  PagePermission,
} from "@/api/userApi";
import type { PageAction } from "@/contexts/types";
import {
  getRolesList,
  getRolePermissions,
  saveRolePermissions,
} from "@/api/roleApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface PageDef {
  key: string;
  label: string;
  group: string;
  module: string;
  actions: string[];
}

/**
 * A record can only be edited after it's Approved if guardEdit() (see
 * backend/services/approvalService.js) sees this specific action granted
 * for the page — every other action on the page (view/create/edit/etc.) is
 * completely untouched by this screen. Wiring: backend/middleware/
 * permissions.js's resolveAllowPostApproval() reads it via the exact same
 * getEffectivePagePermissions() merge Menu Rights uses.
 */
const POST_APPROVAL_ACTION: PageAction = "post-approval";

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function PostApprovalRights() {
  const rights = usePageRights("post-approval-rights");
  const [pageDefs, setPageDefs] = useState<PageDef[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/page-definitions")
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json().catch(() => ({}));
      })
      .then((json) => setPageDefs(json.data ?? []))
      .catch(() => toast.error("Failed to load page definitions"))
      .finally(() => setLoadingDefs(false));
  }, []);

  // Only pages where guardEdit() actually enforces a post-approval check
  // are shown here — granting this elsewhere would do nothing.
  const eligiblePages = useMemo(
    () => pageDefs.filter((p) => p.actions.includes(POST_APPROVAL_ACTION)),
    [pageDefs],
  );

  // ── Subject mode: edit a Role's baseline, or a specific user's overrides ────
  type Subject = "user" | "role";
  const [subject, setSubject] = useState<Subject>("user");

  const [users, setUsers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Full permission set for the selected subject — every page/action, not
  // just the post-approval-eligible ones. Saving writes this whole array
  // back, so a user's existing view/create/edit/etc rights on unrelated
  // pages are never touched by this screen.
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getUsersForRights()
      .then(setUsers)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, []);

  useEffect(() => {
    getRolesList()
      .then(setRoles)
      .catch(() => toast.error("Failed to load roles"))
      .finally(() => setLoadingRoles(false));
  }, []);

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedRole = roles.find((r) => r.RId === selectedRoleId);
  const hasSubjectSelected = subject === "user" ? !!selectedUser : !!selectedRole;

  const switchSubject = useCallback((next: Subject) => {
    setSubject(next);
    setSelectedUserId(null);
    setSelectedRoleId(null);
    setPermissions([]);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (subject !== "user" || !selectedUserId) return;
    setLoadingPerms(true);
    setDirty(false);
    getUserPermissions(selectedUserId)
      .then(setPermissions)
      .catch(() => {
        toast.error("Failed to load permissions");
        setPermissions([]);
      })
      .finally(() => setLoadingPerms(false));
  }, [subject, selectedUserId]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setLoadingPerms(true);
    setDirty(false);
    getRolePermissions(selectedRoleId)
      .then(setPermissions)
      .catch(() => {
        toast.error("Failed to load role permissions");
        setPermissions([]);
      })
      .finally(() => setLoadingPerms(false));
  }, [subject, selectedRoleId]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setUserSearch("");
      }
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setRoleDropdownOpen(false);
        setRoleSearch("");
      }
    };
    if (dropdownOpen || roleDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen, roleDropdownOpen]);

  const filteredUsers = useMemo(
    () => users.filter((u) => u.name.toLowerCase().includes(userSearch.toLowerCase())),
    [users, userSearch],
  );
  const filteredRoles = useMemo(
    () => roles.filter((r) => r.RName.toLowerCase().includes(roleSearch.toLowerCase())),
    [roles, roleSearch],
  );

  const isGranted = (pageKey: string) =>
    permissions.find((p) => p.page === pageKey)?.actions.includes(POST_APPROVAL_ACTION) ?? false;

  const toggle = useCallback((pageKey: string) => {
    setDirty(true);
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const current = idx >= 0 ? [...prev[idx].actions] : [];
      const next = current.includes(POST_APPROVAL_ACTION)
        ? current.filter((a) => a !== POST_APPROVAL_ACTION)
        : [...current, POST_APPROVAL_ACTION];
      const newPerm: PagePermission = { page: pageKey as any, actions: next };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newPerm;
        return copy;
      }
      return [...prev, newPerm];
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (subject === "user") {
      if (!selectedUserId) return;
      setSaving(true);
      try {
        await saveUserPermissions(selectedUserId, permissions);
        toast.success("Post-approval rights saved");
        setDirty(false);
      } catch {
        toast.error("Failed to save");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await saveRolePermissions(selectedRoleId, permissions);
      toast.success("Post-approval rights saved — every user with this role gets this immediately");
      setDirty(false);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [subject, selectedUserId, selectedRoleId, permissions]);

  const grantedCount = eligiblePages.filter((p) => isGranted(p.key)).length;

  return (
    <>
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Post Approval Rights" }]} />

      <AdminShell
        title="Post Approval Rights"
        subtitle="Who can edit a record after it has already been Approved"
        icon={ShieldCheck}
      >
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm p-5 relative mb-4" style={{ zIndex: 40 }}>
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {subject === "user" ? "Select User" : "Select Role"}
            </label>
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
            <p className="text-xs text-muted-foreground/70 mb-3">
              Sets the baseline every user with this role inherits, effective immediately — a user's own overrides (Custom User-wise) can only add on top of this.
            </p>
          )}

          {subject === "user" ? (
            <div className="relative w-full max-w-sm" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-muted hover:border-primary/60 transition-all text-sm font-body"
              >
                <span className={selectedUser ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {loadingUsers ? "Loading users…" : selectedUser ? selectedUser.name : "Choose a user…"}
                </span>
                <div className="flex items-center gap-2">
                  {selectedUser && (
                    <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {selectedUser.role}
                    </span>
                  )}
                  <ChevronDown size={15} className={`text-muted-foreground transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              {dropdownOpen && (
                <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                  <div className="p-2.5 border-b border-border bg-muted/40">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        placeholder="Search user…"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <ul className="max-h-60 overflow-auto py-1">
                    {filteredUsers.length === 0 ? (
                      <li className="px-4 py-3 text-sm text-muted-foreground text-center">No users found</li>
                    ) : (
                      filteredUsers.map((u) => (
                        <li key={u.id}>
                          <button
                            onClick={() => {
                              setSelectedUserId(u.id);
                              setDropdownOpen(false);
                              setUserSearch("");
                            }}
                            className="w-full px-4 py-2.5 text-left hover:bg-muted/60 flex justify-between items-center transition-colors"
                          >
                            <div>
                              <div className="text-sm font-medium text-foreground">{u.name}</div>
                              <div className="text-xs text-muted-foreground capitalize">{u.role.replace(/_/g, " ")}</div>
                            </div>
                            {selectedUserId === u.id && <Check size={14} className="text-primary" />}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full max-w-sm" ref={roleDropdownRef}>
              <button
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-muted hover:border-primary/60 transition-all text-sm font-body"
              >
                <span className={selectedRole ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {loadingRoles ? "Loading roles…" : selectedRole ? selectedRole.RName : "Choose a role…"}
                </span>
                <ChevronDown size={15} className={`text-muted-foreground transition-transform duration-200 ${roleDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {roleDropdownOpen && (
                <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                  <div className="p-2.5 border-b border-border bg-muted/40">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        placeholder="Search role…"
                        value={roleSearch}
                        onChange={(e) => setRoleSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <ul className="max-h-60 overflow-auto py-1">
                    {filteredRoles.length === 0 ? (
                      <li className="px-4 py-3 text-sm text-muted-foreground text-center">No roles found</li>
                    ) : (
                      filteredRoles.map((r) => (
                        <li key={r.RId}>
                          <button
                            onClick={() => {
                              setSelectedRoleId(r.RId);
                              setRoleDropdownOpen(false);
                              setRoleSearch("");
                            }}
                            className="w-full px-4 py-2.5 text-left hover:bg-muted/60 flex justify-between items-center transition-colors"
                          >
                            <div className="text-sm font-medium text-foreground">{r.RName}</div>
                            {selectedRoleId === r.RId && <Check size={14} className="text-primary" />}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {loadingDefs && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Loader2 size={12} className="animate-spin" /> Loading eligible pages…
          </div>
        )}

        {!hasSubjectSelected ? (
          <div className="flex flex-col items-center justify-center h-56 rounded-xl border border-dashed border-border bg-card/40 text-muted-foreground">
            <ShieldCheck className="w-12 h-12 opacity-20 mb-3" />
            <p className="text-sm font-heading">
              {subject === "user" ? "Select a user to manage post-approval rights" : "Select a role to manage its post-approval baseline"}
            </p>
          </div>
        ) : loadingPerms ? (
          <div className="flex justify-center items-center h-64 rounded-xl border border-border bg-card/40">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-card/60">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-primary" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    {subject === "user" ? selectedUser?.name : selectedRole?.RName}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {grantedCount}/{eligiblePages.length} pages granted
                </span>
                {dirty && (
                  <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-xs">
                    Unsaved
                  </span>
                )}
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto inline-flex items-center rounded-lg disabled:opacity-50 transition-all"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {eligiblePages.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground text-center">
                No pages currently support post-approval editing.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground">Page</th>
                    <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground">Module</th>
                    <th className="px-5 py-3 font-heading font-semibold text-muted-foreground text-center">
                      Allow editing after Approved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eligiblePages.map((page) => {
                    const checked = isGranted(page.key);
                    return (
                      <tr key={page.key} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-3 text-foreground">{page.label}</td>
                        <td className="px-5 py-3 text-muted-foreground text-xs">{page.module}</td>
                        <td className="px-5 py-3 text-center">
                          <button
                            onClick={() => toggle(page.key)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              checked ? "bg-primary" : "bg-muted border border-border"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                                checked ? "translate-x-4" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </AdminShell>
    </>
  );
}