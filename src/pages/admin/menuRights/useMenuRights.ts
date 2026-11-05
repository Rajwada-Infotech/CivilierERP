// Everything Menu Rights holds: the page definitions, who is being edited (a role or one user),
// their permissions, and the handlers that change and save them.
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { PRIVILEGED_ROLES } from "@/contexts/auth.utils";
import { toast } from "sonner";
import { getUsersForRights, getUserPermissions, saveUserPermissions, PagePermission } from "@/api/userApi";
import { getRolesList, getRolePermissions, saveRolePermissions } from "@/api/roleApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { PageAction, PageDef, ROLE_PRESETS } from "./config";

export function useMenuRights() {
  const rights = usePageRights("menu-rights");
  // ── Page definitions — now fetched from DB ──────────────────────────────────
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

  // ── Subject mode: edit a Role's baseline, or a specific user's overrides ────
  // The per-user override endpoints (backend/routes/userRights.js) are hard-restricted to admin/super_admin/dba, with
  // no page-scoping, so a non-admin-tier menu-rights grant (marketing_head's, which replaced the retired SA Role
  // Master) covers only the Role-wise baseline — that one is page-scoped (backend/routes/roles.js checkPermission).
  type Subject = "user" | "role";
  const { currentUser } = useAuth();
  const isAdminTier = currentUser ? PRIVILEGED_ROLES.includes(currentUser.role) : false;
  const [subject, setSubject] = useState<Subject>(isAdminTier ? "user" : "role");

  const [users, setUsers] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const [loadingRoles, setLoadingRoles] = useState(true);

  const [pageSearch, setPageSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("All");
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load users — not for a non-admin-tier user: GET /api/user-rights/users refuses them whatever their page rights.
  useEffect(() => {
    if (!isAdminTier) { setLoadingUsers(false); return; }
    getUsersForRights()
      .then(setUsers)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, [isAdminTier]);

  // Load roles
  useEffect(() => {
    getRolesList()
      .then(setRoles)
      .catch(() => toast.error("Failed to load roles"))
      .finally(() => setLoadingRoles(false));
  }, []);

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedRole = roles.find((r) => r.RId === selectedRoleId);

  // Switching subject mode clears the other mode's selection so state can't
  // leak between "editing Sourav" and "editing Account's Head".
  const switchSubject = useCallback((next: Subject) => {
    setSubject(next);
    setSelectedUserId(null);
    setSelectedRoleId(null);
    setPermissions([]);
    setDirty(false);
  }, []);

  // Load permissions when a user is selected (user mode)
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

  // Load permissions when a role is selected (role mode)
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
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setUserSearch("");
      }
      if (
        roleDropdownRef.current &&
        !roleDropdownRef.current.contains(e.target as Node)
      ) {
        setRoleDropdownOpen(false);
        setRoleSearch("");
      }
    };
    if (dropdownOpen || roleDropdownOpen)
      document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen, roleDropdownOpen]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const modules = useMemo(
    () => ["All", ...Array.from(new Set(pageDefs.map((p) => p.module)))],
    [pageDefs],
  );

  const filteredPages = useMemo(
    () =>
      pageDefs.filter((p) => {
        const matchModule = moduleFilter === "All" || p.module === moduleFilter;
        const matchSearch =
          !pageSearch ||
          p.label.toLowerCase().includes(pageSearch.toLowerCase()) ||
          p.group.toLowerCase().includes(pageSearch.toLowerCase());
        return matchModule && matchSearch;
      }),
    [pageDefs, moduleFilter, pageSearch],
  );

  // Three tiers, in this fixed order: Dashboards (every module's dashboard,
  // together), Setup (every module's setup/master pages, together — "Setup"
  // matches the exact label TopNavbar's own Setup dropdown uses), then every
  // other page grouped by its own module as before. Putting the two
  // cross-module tiers first means granting "every dashboard" or "every
  // setup page" is one scroll, not a hunt through each module in turn.
  const TIER_ORDER = ["Dashboards", "Setup"];
  const groupedPages = useMemo(() => {
    const groups: Record<string, PageDef[]> = {};
    filteredPages.forEach((p) => {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    });
    const entries = Object.entries(groups);
    entries.sort(([a], [b]) => {
      const ai = TIER_ORDER.indexOf(a);
      const bi = TIER_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? TIER_ORDER.length : ai) - (bi === -1 ? TIER_ORDER.length : bi);
      return a.localeCompare(b);
    });
    return entries;
  }, [filteredPages]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) =>
        u.name.toLowerCase().includes(userSearch.toLowerCase()),
      ),
    [users, userSearch],
  );

  const filteredRoles = useMemo(
    () =>
      roles.filter((r) =>
        r.RName.toLowerCase().includes(roleSearch.toLowerCase()),
      ),
    [roles, roleSearch],
  );

  // ── Permission helpers ─────────────────────────────────────────────────────
  const getPermForPage = (pageKey: string) =>
    permissions.find((p) => p.page === pageKey);
  const isChecked = (pageKey: string, action: PageAction) =>
    getPermForPage(pageKey)?.actions.includes(action) ?? false;

  const togglePermission = useCallback(
    (pageKey: string, action: PageAction) => {
      setDirty(true);
      setPermissions((prev) => {
        const idx = prev.findIndex((p) => p.page === pageKey);
        const current = idx >= 0 ? [...prev[idx].actions] : [];
        const newActions = current.includes(action)
          ? current.filter((a) => a !== action)
          : [...current, action];
        const newPerm: PagePermission = {
          page: pageKey as any,
          actions: newActions,
        };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newPerm;
          return copy;
        }
        return [...prev, newPerm];
      });
    },
    [],
  );

  const toggleAllForPage = useCallback(
    (pageKey: string, availableActions: PageAction[]) => {
      setDirty(true);
      setPermissions((prev) => {
        const idx = prev.findIndex((p) => p.page === pageKey);
        const current = idx >= 0 ? prev[idx].actions : [];
        const allChecked = availableActions.every((a) => current.includes(a));
        const newActions = allChecked ? [] : [...availableActions];
        const newPerm: PagePermission = {
          page: pageKey as any,
          actions: newActions,
        };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newPerm;
          return copy;
        }
        return [...prev, newPerm];
      });
    },
    [],
  );

  // ── Apply preset ───────────────────────────────────────────────────────────
  const applyPreset = useCallback(
    (presetKey: string) => {
      const preset = ROLE_PRESETS[presetKey];
      if (!preset) return;
      setDirty(true);
      // "viewer" preset uses all currently-loaded page defs
      const targetPages =
        preset.pages.length > 0 ? preset.pages : pageDefs.map((p) => p.key);
      const newPerms: PagePermission[] = targetPages
        .map((pageKey) => {
          const pageDef = pageDefs.find((p) => p.key === pageKey);
          if (!pageDef) return null;
          const allowedActions = preset.actions.filter((a) =>
            pageDef.actions.includes(a),
          );
          return { page: pageKey as any, actions: allowedActions };
        })
        .filter(Boolean) as PagePermission[];
      setPermissions(newPerms);
      toast.success(`Applied ${preset.label} preset`);
    },
    [pageDefs],
  );

  // ── Toggle entire group ─────────────────────────────────────────────────────
  const toggleGroup = useCallback(
    (groupPages: PageDef[]) => {
      setDirty(true);
      const allFullyChecked = groupPages.every((p) =>
        p.actions.every((a) => isChecked(p.key, a)),
      );
      setPermissions((prev) => {
        const keys = new Set(groupPages.map((p) => p.key));
        const filtered = prev.filter((p) => !keys.has(p.page));
        if (allFullyChecked) return filtered;
        const newPerms: PagePermission[] = groupPages.map((p) => ({
          page: p.key as any,
          actions: [...p.actions],
        }));
        return [...filtered, ...newPerms];
      });
    },
    [isChecked],
  );

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (subject === "user") {
      if (!selectedUserId) return;
      setSaving(true);
      try {
        await saveUserPermissions(selectedUserId, permissions);
        toast.success("Permissions saved successfully");
        setDirty(false);
      } catch {
        toast.error("Failed to save permissions");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await saveRolePermissions(selectedRoleId, permissions);
      toast.success(
        "Role permissions saved — every user with this role gets these rights immediately",
      );
      setDirty(false);
    } catch {
      toast.error("Failed to save role permissions");
    } finally {
      setSaving(false);
    }
  }, [subject, selectedUserId, selectedRoleId, permissions]);

  const hasSubjectSelected = subject === "user" ? !!selectedUser : !!selectedRole;

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      pagesGranted: permissions.filter((p) => p.actions.length > 0).length,
      total: pageDefs.length,
      actionsGranted: permissions.reduce((acc, p) => acc + p.actions.length, 0),
    }),
    [permissions, pageDefs],
  );

  return {
    rights,
    isAdminTier,
    pageDefs,
    setPageDefs,
    loadingDefs,
    setLoadingDefs,
    subject,
    setSubject,
    users,
    setUsers,
    selectedUserId,
    setSelectedUserId,
    dropdownOpen,
    setDropdownOpen,
    userSearch,
    setUserSearch,
    roles,
    setRoles,
    selectedRoleId,
    setSelectedRoleId,
    roleDropdownOpen,
    setRoleDropdownOpen,
    roleSearch,
    setRoleSearch,
    loadingRoles,
    setLoadingRoles,
    pageSearch,
    setPageSearch,
    moduleFilter,
    setModuleFilter,
    permissions,
    setPermissions,
    loadingUsers,
    setLoadingUsers,
    loadingPerms,
    setLoadingPerms,
    saving,
    setSaving,
    dirty,
    setDirty,
    selectedUser,
    selectedRole,
    switchSubject,
    dropdownRef,
    roleDropdownRef,
    modules,
    filteredPages,
    TIER_ORDER,
    groupedPages,
    filteredUsers,
    filteredRoles,
    getPermForPage,
    isChecked,
    togglePermission,
    toggleAllForPage,
    applyPreset,
    toggleGroup,
    handleSave,
    hasSubjectSelected,
    stats,
  };
}

export type MenuRightsState = ReturnType<typeof useMenuRights>;
