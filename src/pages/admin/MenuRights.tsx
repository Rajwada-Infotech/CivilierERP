import React from "react";
import { useState, useMemo, useCallback, useEffect } from "react";
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
import { toast } from "sonner";
import {
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
  PagePermission,
} from "@/api/userApi";

type PageAction = "view" | "create" | "edit" | "delete" | "print" | "export";

interface PageDef {
  key: string;
  label: string;
  group: string;
  actions: PageAction[];
}

const ALL_ACTIONS: { key: PageAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "export", label: "Export" },
];

const PAGE_DEFINITIONS: PageDef[] = [
  {
    key: "bank-master",
    label: "Bank Master",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "account-head",
    label: "Account Head Master",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "general-ledger",
    label: "General Ledger",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "journal-voucher",
    label: "Journal Voucher",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "cheque-master",
    label: "Cheque Master",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "finance-dashboard",
    label: "Finance Dashboard",
    group: "Finance & Accounts",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "purchase-orders",
    label: "Purchase Orders",
    group: "Purchases",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "grn-master",
    label: "GRN Master",
    group: "Purchases",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "item-master",
    label: "Item Master",
    group: "Inventory",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "item-group",
    label: "Item Group",
    group: "Inventory",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "hsn-master",
    label: "HSN Master",
    group: "Inventory",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "work-order",
    label: "Work Order",
    group: "Materials",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "material-dashboard",
    label: "Material Dashboard",
    group: "Materials",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "general-ledger-report",
    label: "General Ledger Report",
    group: "Reports",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
  {
    key: "finance-report",
    label: "Finance Report",
    group: "Reports",
    actions: ALL_ACTIONS.map((a) => a.key),
  },
];

export default function MenuRights() {
  const [users, setUsers] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getUsersForRights()
      .then(setUsers)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, []);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  useEffect(() => {
    if (!selectedUserId) {
      setPermissions([]);
      return;
    }
    setLoadingPerms(true);
    getUserPermissions(selectedUserId)
      .then(setPermissions)
      .catch(() => {
        toast.error("Failed to load permissions");
        setPermissions([]);
      })
      .finally(() => setLoadingPerms(false));
  }, [selectedUserId]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) =>
        u.name.toLowerCase().includes(userSearch.toLowerCase()),
      ),
    [users, userSearch],
  );

  const relevantPages = useMemo(
    () =>
      PAGE_DEFINITIONS.filter(
        (p) =>
          p.label.toLowerCase().includes(pageSearch.toLowerCase()) ||
          p.group.toLowerCase().includes(pageSearch.toLowerCase()),
      ),
    [pageSearch],
  );

  const groupedPages = useMemo(() => {
    const groups: Record<string, PageDef[]> = {};
    relevantPages.forEach((p) => {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    });
    return groups;
  }, [relevantPages]);

  const getPermForPage = (pageKey: string) =>
    permissions.find((p) => p.page === pageKey);
  const isChecked = (pageKey: string, action: PageAction) =>
    getPermForPage(pageKey)?.actions.includes(action) ?? false;

  const togglePermission = (pageKey: string, action: PageAction) => {
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const current = idx >= 0 ? [...prev[idx].actions] : [];
      const newActions = current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action];
      const newPerm: PagePermission = { page: pageKey, actions: newActions };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newPerm;
        return copy;
      }
      return [...prev, newPerm];
    });
  };

  const toggleAllForPage = (pageKey: string, pageActions: PageAction[]) => {
    const current = getPermForPage(pageKey)?.actions || [];
    const allChecked = pageActions.every((a) => current.includes(a));
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const newPerm: PagePermission = {
        page: pageKey,
        actions: allChecked ? [] : [...pageActions],
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newPerm;
        return copy;
      }
      return [...prev, newPerm];
    });
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await saveUserPermissions(selectedUserId, permissions);
      toast.success(`Permissions saved for ${selectedUser?.name}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Menu Rights"]} />

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Menu Rights</h1>
            <p className="text-sm text-muted-foreground">
              Assign page-level permissions per user
            </p>
          </div>
        </div>

        {selectedUser && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all shadow-sm"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? "Saving…" : "Save Permissions"}
          </button>
        )}
      </div>

      {/* ── User Selector Card ───────────────────────────────────────────── */}
      <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm p-5 mb-5">
        <label className="flex items-center gap-2 text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          <Users className="w-3.5 h-3.5" /> Select User
        </label>

        <div className="relative w-full max-w-sm">
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
            <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
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
                        className="w-full px-4 py-2.5 text-left hover:bg-muted/60 flex justify-between items-center transition-colors group"
                      >
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {u.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {u.role}
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

      {/* ── Permissions Table ────────────────────────────────────────────── */}
      {!selectedUser ? (
        <div className="flex flex-col items-center justify-center h-56 rounded-xl border border-dashed border-border bg-card/40 text-muted-foreground">
          <ShieldCheck className="w-12 h-12 opacity-20 mb-3" />
          <p className="text-sm font-heading">
            Select a user to manage menu permissions
          </p>
        </div>
      ) : loadingPerms ? (
        <div className="flex justify-center items-center h-64 rounded-xl border border-border bg-card/40">
          <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          {/* Table toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-card/60">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck size={14} className="text-primary" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-heading font-semibold text-foreground">
                  {selectedUser.name}
                </span>
                <span className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                  {selectedUser.role}
                </span>
              </div>
            </div>

            {/* Page search */}
            <div className="relative w-full sm:w-60">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                placeholder="Search menu or group…"
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground min-w-[220px]">
                    Menu / Page
                  </th>
                  {ALL_ACTIONS.map((a) => (
                    <th
                      key={a.key}
                      className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[70px]"
                    >
                      {a.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[70px]">
                    All
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groupedPages).map(([group, pages]) => (
                  <React.Fragment key={group}>
                    <tr>
                      <td
                        colSpan={ALL_ACTIONS.length + 2}
                        className="px-5 py-2 bg-primary/5 border-y border-primary/10 text-[10px] font-heading font-bold text-primary uppercase tracking-widest"
                      >
                        {group}
                      </td>
                    </tr>

                    {pages.map((page) => {
                      const checkedCount = page.actions.filter((a) =>
                        isChecked(page.key, a),
                      ).length;
                      const allChecked = checkedCount === page.actions.length;
                      const someChecked = checkedCount > 0 && !allChecked;

                      return (
                        <tr
                          key={page.key}
                          className="border-b border-border hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-5 py-3 text-sm font-body text-foreground">
                            {page.label}
                          </td>
                          {ALL_ACTIONS.map((action) => (
                            <td
                              key={action.key}
                              className="px-3 py-3 text-center"
                            >
                              <button
                                onClick={() =>
                                  togglePermission(page.key, action.key)
                                }
                                className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                                  isChecked(page.key, action.key)
                                    ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                    : "border-border bg-muted hover:border-primary/50 hover:bg-muted/80"
                                }`}
                              >
                                {isChecked(page.key, action.key) && (
                                  <Check className="w-3 h-3" />
                                )}
                              </button>
                            </td>
                          ))}
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() =>
                                toggleAllForPage(page.key, page.actions)
                              }
                              className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                                allChecked
                                  ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                  : someChecked
                                    ? "bg-primary/20 border-primary/40"
                                    : "border-border bg-muted hover:border-primary/50 hover:bg-muted/80"
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-body">
              {permissions.filter((p) => p.actions.length > 0).length} of{" "}
              {PAGE_DEFINITIONS.length} pages have permissions assigned
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all shadow-sm"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
