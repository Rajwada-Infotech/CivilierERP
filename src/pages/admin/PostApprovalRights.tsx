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
import { SheetShell } from "@/components/sheet/Sheet";
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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const TAG = "inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

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

  // One searchable picker, used for both users and roles.
  const picker = (opts: {
    ref: React.RefObject<HTMLDivElement>;
    open: boolean;
    setOpen: (o: boolean) => void;
    label: string;
    placeholder: string;
    search: string;
    setSearch: (s: string) => void;
    tag?: string;
    items: { id: number; name: string; sub?: string }[];
    selectedId: number | null;
    onPick: (id: number) => void;
    empty: string;
  }) => (
    <div className="relative w-full max-w-sm" ref={opts.ref}>
      <button
        onClick={() => opts.setOpen(!opts.open)}
        className="w-full h-10 flex items-center justify-between gap-2 px-3 border border-foreground/40 hover:border-foreground bg-card text-sm transition-colors"
        aria-expanded={opts.open}
      >
        <span className={opts.label ? "text-foreground font-medium truncate" : "text-muted-foreground"}>{opts.label || opts.placeholder}</span>
        <span className="flex items-center gap-2 shrink-0">
          {opts.tag && <span className={`${TAG} text-foreground border-foreground/40 capitalize`}>{opts.tag}</span>}
          <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${opts.open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {opts.open && (
        <div className="absolute z-50 mt-1 w-full border border-foreground bg-card overflow-hidden" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
          <div className="p-2" style={{ borderBottom: RULE }}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                placeholder="Search…"
                value={opts.search}
                onChange={(e) => opts.setSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-auto">
            {opts.items.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground text-center">{opts.empty}</li>
            ) : (
              opts.items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => opts.onPick(it.id)}
                    className={`w-full px-3 py-2 text-left flex justify-between items-center border-b border-foreground/10 last:border-0 transition-colors ${
                      opts.selectedId === it.id ? "bg-primary/10" : "hover:bg-primary/5"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">{it.name}</span>
                      {it.sub && <span className="block text-xs text-muted-foreground capitalize">{it.sub}</span>}
                    </span>
                    {opts.selectedId === it.id && <Check size={14} className="text-foreground shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Post Approval Rights" }]} />

      <SheetShell
        eyebrow="CivilierERP · Approvals"
        title="Post-approval rights"
        subtitle="Who may still edit a record after it has been approved, page by page. Set it for a role, or add to it for one person."
      >
        <div className="bg-card relative" style={{ border: RULE, zIndex: 40 }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>{subject === "user" ? "Choose a person" : "Choose a role"}</span>
            <div className="inline-flex items-stretch border border-foreground">
              {([["role", "Role-wise"], ["user", "Custom user-wise"]] as const).map(([key, label], i) => (
                <button
                  key={key}
                  onClick={() => switchSubject(key)}
                  aria-pressed={subject === key}
                  className={`h-8 px-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${i ? "border-l border-foreground" : ""} ${
                    subject === key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-4 space-y-3">
            {subject === "role" && (
              <p className="text-xs text-muted-foreground max-w-prose">
                Sets the baseline every user with this role inherits, effective immediately — a user's own overrides (Custom user-wise) can only add on top of this.
              </p>
            )}
            {subject === "user"
              ? picker({
                  ref: dropdownRef,
                  open: dropdownOpen,
                  setOpen: (o) => { setDropdownOpen(o); if (!o) setUserSearch(""); },
                  label: loadingUsers ? "" : selectedUser?.name ?? "",
                  placeholder: loadingUsers ? "Loading users…" : "Choose a user…",
                  search: userSearch,
                  setSearch: setUserSearch,
                  tag: selectedUser?.role.replace(/_/g, " "),
                  items: filteredUsers.map((u) => ({ id: u.id, name: u.name, sub: u.role.replace(/_/g, " ") })),
                  selectedId: selectedUserId,
                  onPick: (id) => { setSelectedUserId(id); setDropdownOpen(false); setUserSearch(""); },
                  empty: "No users found",
                })
              : picker({
                  ref: roleDropdownRef,
                  open: roleDropdownOpen,
                  setOpen: (o) => { setRoleDropdownOpen(o); if (!o) setRoleSearch(""); },
                  label: loadingRoles ? "" : selectedRole?.RName ?? "",
                  placeholder: loadingRoles ? "Loading roles…" : "Choose a role…",
                  search: roleSearch,
                  setSearch: setRoleSearch,
                  items: filteredRoles.map((r) => ({ id: r.RId, name: r.RName })),
                  selectedId: selectedRoleId,
                  onPick: (id) => { setSelectedRoleId(id); setRoleDropdownOpen(false); setRoleSearch(""); },
                  empty: "No roles found",
                })}
          </div>
        </div>

        {loadingDefs && (
          <div className={`flex items-center gap-2 ${LBL}`}>
            <Loader2 size={12} className="animate-spin" /> Loading eligible pages
          </div>
        )}

        {!hasSubjectSelected ? (
          <div className="flex items-center justify-center h-40 border border-dashed border-foreground/40 text-sm text-muted-foreground">
            {subject === "user" ? "Choose a person to manage their post-approval rights." : "Choose a role to manage its post-approval baseline."}
          </div>
        ) : loadingPerms ? (
          <div className="flex justify-center items-center h-40 bg-card" style={{ border: RULE }}>
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className={HEAD}>{subject === "user" ? selectedUser?.name : selectedRole?.RName}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-heading font-semibold tabular-nums text-foreground">{grantedCount}</span> of {eligiblePages.length} pages granted
                </span>
                {dirty && <span className={`${TAG} text-foreground border-dashed border-foreground`}>Unsaved</span>}
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="h-9 px-5 inline-flex items-center gap-1.5 bg-foreground text-card border border-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] disabled:opacity-40 transition-opacity"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {eligiblePages.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground text-center">No pages currently support post-approval editing.</p>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                      <th className="text-left px-4 py-2.5 font-semibold">Page</th>
                      <th className="text-left px-4 py-2.5 font-semibold">Module</th>
                      <th className="px-4 py-2.5 font-semibold text-center">Allow editing after approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligiblePages.map((page) => {
                      const checked = isGranted(page.key);
                      return (
                        <tr key={page.key} className="hover:bg-primary/5 transition-colors" style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.1)" }}>
                          <td className={`px-4 py-2.5 ${checked ? "text-foreground font-medium" : "text-foreground"}`}>{page.label}</td>
                          <td className="px-4 py-2.5">
                            <span className={`${TAG} text-muted-foreground border-foreground/30`}>{page.module}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => toggle(page.key)}
                              role="switch"
                              aria-checked={checked}
                              aria-label={`Allow editing ${page.label} after approval`}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? "bg-foreground" : "bg-muted-foreground/30"}`}
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SheetShell>
    </>
  );
}
