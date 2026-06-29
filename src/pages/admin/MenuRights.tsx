import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  ShieldCheck,
  Search,
  Save,
  ChevronDown,
  Check,
  Users,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { toast } from "sonner";
import {
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
  PagePermission,
} from "@/api/userApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── TYPES ───────────────────────────────────────────────────────────────────
type PageAction = "view" | "create" | "edit" | "delete" | "print" | "export";

interface PageDef {
  key: string;
  label: string;
  group: string;
  module: string;
  actions: PageAction[];
}

// ─── ALL ACTIONS ─────────────────────────────────────────────────────────────
const ALL_ACTIONS: { key: PageAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "export", label: "Export" },
];

// ─── MODULE COLORS ────────────────────────────────────────────────────────────
const MODULE_COLORS: Record<string, string> = {
  General: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  Finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Material: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Engineering: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Follow-Up": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Ticket: "bg-red-500/10 text-red-400 border-red-500/20",
  Sales: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  "Civil Work DPR": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Masters: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Reports: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

// ─── PRESET TEMPLATES ─────────────────────────────────────────────────────────
// Presets reference page keys — these are stable identifiers so hardcoding is fine.
const ROLE_PRESETS: Record<
  string,
  { label: string; pages: string[]; actions: PageAction[] }
> = {
  engineer: {
    label: "Engineer",
    pages: [
      "dashboard",
      "engineering-dashboard",
      "boq",
      "engineering-work-order",
      "work-done",
      "purchase-orders",
      "grn-master",
      "work-order",
      "material-request",
      "stock-ledger",
      "tickets",
      "followup-applicants",
      "followup-bookings",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit"],
  },
  finance: {
    label: "Finance",
    pages: [
      "dashboard",
      "finance-dashboard",
      "expense-booking",
      "new-payment",
      "received-payment",
      "bank-master",
      "account-head",
      "general-ledger",
      "cheque-master",
      "brs",
      "debit-note",
      "amendments",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  store: {
    label: "Store Manager",
    pages: [
      "dashboard",
      "material-dashboard",
      "purchase-orders",
      "grn-master",
      "work-order",
      "material-request",
      "material-issues",
      "stock-ledger",
      "stock-transfers",
      "inventory-master",
      "item-master",
      "item-group",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  sales: {
    label: "Sales",
    pages: [
      "dashboard",
      "sale-order",
      "sale-invoice",
      "sales-payment",
      "reports",
      "tasks",
    ],
    actions: ["view", "create", "edit", "print", "export"],
  },
  viewer: {
    label: "View Only",
    // "All pages" preset — resolved at runtime against the live DB list
    pages: [],
    actions: ["view"],
  },
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function MenuRights() {
  // ── Page definitions — now fetched from DB ──────────────────────────────────
  const [pageDefs, setPageDefs] = useState<PageDef[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/page-definitions")
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((json) => setPageDefs(json.data ?? []))
      .catch(() => toast.error("Failed to load page definitions"))
      .finally(() => setLoadingDefs(false));
  }, []);

  const [users, setUsers] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("All");
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load users
  useEffect(() => {
    getUsersForRights()
      .then(setUsers)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, []);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  // Load permissions when user selected
  useEffect(() => {
    if (!selectedUserId) {
      setPermissions([]);
      return;
    }
    setLoadingPerms(true);
    setDirty(false);
    getUserPermissions(selectedUserId)
      .then(setPermissions)
      .catch(() => {
        toast.error("Failed to load permissions");
        setPermissions([]);
      })
      .finally(() => setLoadingPerms(false));
  }, [selectedUserId]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setUserSearch("");
      }
    };
    if (dropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

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

  const groupedPages = useMemo(() => {
    const groups: Record<string, PageDef[]> = {};
    filteredPages.forEach((p) => {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    });
    return groups;
  }, [filteredPages]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) =>
        u.name.toLowerCase().includes(userSearch.toLowerCase()),
      ),
    [users, userSearch],
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
  }, [selectedUserId, permissions]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      pagesGranted: permissions.filter((p) => p.actions.length > 0).length,
      total: pageDefs.length,
      actionsGranted: permissions.reduce((acc, p) => acc + p.actions.length, 0),
    }),
    [permissions, pageDefs],
  );

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Menu Rights" }]} />

      <AdminShell
        title="Menu Rights"
        subtitle="Configure per-user page and action permissions"
        icon={ShieldCheck}
        action={
          selectedUser && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">
                Quick presets:
              </span>
              {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="px-2.5 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )
        }
      >
        {/* ── User Selector Card ───────────────────────────────────────────── */}
        <div
          className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm p-5 relative"
          style={{ zIndex: 40 }}
        >
          <label className="flex items-center gap-2 text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <Users className="w-3.5 h-3.5" /> Select User
          </label>

          <div className="relative w-full max-w-sm" ref={dropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-muted hover:border-primary/60 transition-all text-sm font-body"
            >
              <span
                className={
                  selectedUser
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }
              >
                {loadingUsers
                  ? "Loading users…"
                  : selectedUser
                    ? selectedUser.name
                    : "Choose a user…"}
              </span>
              <div className="flex items-center gap-2">
                {selectedUser && (
                  <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {selectedUser.role}
                  </span>
                )}
                <ChevronDown
                  size={15}
                  className={`text-muted-foreground transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                <div className="p-2.5 border-b border-border bg-muted/40">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
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
                    <li className="px-4 py-3 text-sm text-muted-foreground text-center">
                      No users found
                    </li>
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
                            <div className="text-sm font-medium text-foreground">
                              {u.name}
                            </div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {u.role.replace(/_/g, " ")}
                            </div>
                          </div>
                          {selectedUserId === u.id && (
                            <Check size={14} className="text-primary" />
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Loading page definitions */}
        {loadingDefs && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Loader2 size={12} className="animate-spin" /> Loading page
            definitions…
          </div>
        )}

        {/* Main panel */}
        {!selectedUser ? (
          <div className="flex flex-col items-center justify-center h-56 rounded-xl border border-dashed border-border bg-card/40 text-muted-foreground">
            <ShieldCheck className="w-12 h-12 opacity-20 mb-3" />
            <p className="text-sm font-heading">
              Select a user to manage permissions
            </p>
          </div>
        ) : loadingPerms ? (
          <div className="flex justify-center items-center h-64 rounded-xl border border-border bg-card/40">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-card/60">
              <div className="flex items-center gap-3 flex-wrap">
                {/* User badge */}
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-primary" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    {selectedUser.name}
                  </span>
                  <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                    {selectedUser.role.replace(/_/g, " ")}
                  </span>
                </div>
                {/* Stats */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {stats.pagesGranted}/{stats.total} pages
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-muted border border-border">
                    {stats.actionsGranted} actions
                  </span>
                  {dirty && (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                      Unsaved
                    </span>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                {/* Module filter */}
                <div className="flex items-center gap-1 overflow-x-auto">
                  {modules.map((mod) => (
                    <button
                      key={mod}
                      onClick={() => setModuleFilter(mod)}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-colors font-medium ${
                        moduleFilter === mod
                          ? mod === "All"
                            ? "gradient-accent text-white border-transparent font-semibold"
                            : mod === "General"
                              ? "bg-slate-500 text-white border-slate-500 font-semibold"
                              : mod === "Finance"
                                ? "bg-emerald-500 text-white border-emerald-500 font-semibold"
                                : mod === "Material"
                                  ? "bg-blue-500 text-white border-blue-500 font-semibold"
                                  : mod === "Engineering"
                                    ? "bg-orange-500 text-white border-orange-500 font-semibold"
                                    : mod === "Follow-Up"
                                      ? "bg-purple-500 text-white border-purple-500 font-semibold"
                                      : mod === "Ticket"
                                        ? "bg-red-500 text-white border-red-500 font-semibold"
                                        : mod === "Sales"
                                          ? "bg-pink-500 text-white border-pink-500 font-semibold"
                                          : mod === "Masters"
                                            ? "bg-cyan-500 text-white border-cyan-500 font-semibold"
                                            : mod === "Reports"
                                              ? "bg-yellow-500 text-white border-yellow-500 font-semibold"
                                              : "gradient-accent text-white border-transparent font-semibold"
                          : mod === "All"
                            ? "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                            : mod === "General"
                              ? "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400 hover:bg-slate-500/20"
                              : mod === "Finance"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                                : mod === "Material"
                                  ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                                  : mod === "Engineering"
                                    ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20"
                                    : mod === "Follow-Up"
                                      ? "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20"
                                      : mod === "Ticket"
                                        ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                        : mod === "Sales"
                                          ? "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20"
                                          : mod === "Masters"
                                            ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20"
                                            : mod === "Reports"
                                              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20"
                                              : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {mod}
                    </button>
                  ))}
                </div>
                {/* Page search */}
                <div className="relative w-44">
                  <Search
                    size={11}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    placeholder="Search page…"
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground min-w-[240px]">
                      Menu / Page
                    </th>
                    {ALL_ACTIONS.map((a) => (
                      <th
                        key={a.key}
                        className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px]"
                      >
                        {a.label}
                      </th>
                    ))}
                    <th className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px]">
                      All
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedPages).map(([group, pages]) => {
                    const groupModule = pages[0]?.module ?? "General";
                    const colorClass =
                      MODULE_COLORS[groupModule] ??
                      "bg-muted/30 text-muted-foreground";
                    const allGroupChecked = pages.every((p) =>
                      p.actions.every((a) => isChecked(p.key, a)),
                    );

                    return (
                      <React.Fragment key={group}>
                        {/* Group header */}
                        <tr>
                          <td
                            colSpan={ALL_ACTIONS.length + 2}
                            className="px-5 py-2 border-y border-border/50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] font-heading font-bold px-2 py-0.5 rounded-full border ${colorClass}`}
                                >
                                  {groupModule}
                                </span>
                                <span className="text-[11px] font-heading font-semibold text-foreground uppercase tracking-wider">
                                  {group}
                                </span>
                              </div>
                              <button
                                onClick={() => toggleGroup(pages)}
                                className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-colors ${
                                  allGroupChecked
                                    ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                                }`}
                              >
                                {allGroupChecked ? "Revoke all" : "Grant all"}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Page rows */}
                        {pages.map((page) => {
                          const checkedCount = page.actions.filter((a) =>
                            isChecked(page.key, a),
                          ).length;
                          const allChecked =
                            checkedCount === page.actions.length;
                          const someChecked = checkedCount > 0 && !allChecked;

                          return (
                            <tr
                              key={page.key}
                              className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                            >
                              <td className="px-5 py-2.5 text-sm font-body text-foreground pl-10">
                                {page.label}
                              </td>
                              {ALL_ACTIONS.map((action) => {
                                const available = page.actions.includes(
                                  action.key,
                                );
                                const checked = isChecked(page.key, action.key);
                                return (
                                  <td
                                    key={action.key}
                                    className="px-3 py-2.5 text-center"
                                  >
                                    {available ? (
                                      <button
                                        onClick={() =>
                                          togglePermission(page.key, action.key)
                                        }
                                        className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                                          checked
                                            ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                            : "border-border bg-muted hover:border-primary/50"
                                        }`}
                                      >
                                        {checked && (
                                          <Check className="w-3 h-3" />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-border/30 bg-muted/20">
                                        <span className="w-1.5 h-px bg-border/40 block rounded" />
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                              {/* All toggle */}
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  onClick={() =>
                                    toggleAllForPage(page.key, page.actions)
                                  }
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                                    allChecked
                                      ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                      : someChecked
                                        ? "bg-primary/20 border-primary/40"
                                        : "border-border bg-muted hover:border-primary/50"
                                  }`}
                                >
                                  {allChecked && <Check className="w-3 h-3" />}
                                  {someChecked && (
                                    <span className="w-2 h-0.5 bg-primary block rounded" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-body">
                {stats.pagesGranted} of {stats.total} pages ·{" "}
                {stats.actionsGranted} total actions granted
              </p>
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto inline-flex items-center rounded-lg disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {saving ? "Saving…" : "Save Permissions"}
              </button>
            </div>
          </div>
        )}
      </AdminShell>
    </>
  );
}
