import React, { useState, useMemo, useCallback, useEffect } from "react";
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
} from "@/api/userApi"; // Adjust path if needed

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
  // Finance & Accounts
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
  // Purchases
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
  // Inventory
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
  // Materials
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
  // Reports
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
  const [searchTerm, setSearchTerm] = useState("");
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch users
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
    getUserPermissions(selectedUserId)
      .then(setPermissions)
      .catch(() => {
        toast.error("Failed to load permissions");
        setPermissions([]);
      })
      .finally(() => setLoadingPerms(false));
  }, [selectedUserId]);

  const relevantPages = useMemo(() => {
    return PAGE_DEFINITIONS.filter(
      (p) =>
        p.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.group.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [searchTerm]);

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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save Permissions"}
          </button>
        )}
      </div>

      {/* User Selector */}
      <div className="bg-card border rounded-xl p-5 mb-6 shadow-sm">
        <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
          <Users className="w-4 h-4" /> Select User
        </label>
        <div className="relative w-full max-w-sm">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border bg-background hover:border-primary/60"
          >
            <span
              className={selectedUser ? "font-medium" : "text-muted-foreground"}
            >
              {selectedUser
                ? `${selectedUser.name} — ${selectedUser.role}`
                : "Choose a user…"}
            </span>
            <ChevronDown
              className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute z-30 mt-1 w-full bg-popover border rounded-lg shadow-xl overflow-hidden">
              <div className="p-2 border-b">
                <input
                  autoFocus
                  placeholder="Search user..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm rounded-md border focus:border-primary"
                />
              </div>
              <ul className="max-h-60 overflow-auto py-1">
                {users.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => {
                        setSelectedUserId(u.id);
                        setDropdownOpen(false);
                        setSearchTerm("");
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-accent flex justify-between items-center"
                    >
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.role}
                        </div>
                      </div>
                      {selectedUserId === u.id && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Permissions Table */}
      {!selectedUser ? (
        <div className="flex flex-col items-center justify-center h-56 border border-dashed rounded-xl text-muted-foreground">
          <ShieldCheck className="w-12 h-12 opacity-30 mb-3" />
          <p>Select a user to manage menu permissions</p>
        </div>
      ) : loadingPerms ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b bg-muted/30">
            <div>
              <span className="font-semibold">{selectedUser.name}</span>
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {selectedUser.role}
              </span>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <input
                placeholder="Search menu or group..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground min-w-[220px] border-b">
                    Menu / Page
                  </th>
                  {ALL_ACTIONS.map((a) => (
                    <th
                      key={a.key}
                      className="px-3 py-3 font-semibold text-muted-foreground border-b text-center min-w-[70px]"
                    >
                      {a.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-semibold text-muted-foreground border-b text-center min-w-[70px]">
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
                        className="px-4 py-2 bg-primary/5 border-y border-primary/10 text-xs font-bold text-primary uppercase tracking-widest"
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
                          className="border-b hover:bg-accent/40"
                        >
                          <td className="px-4 py-3 font-medium">
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
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "border-border hover:border-primary/50"
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
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : someChecked
                                    ? "bg-primary/30 border-primary/40"
                                    : "border-border hover:border-primary/50"
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
        </div>
      )}
    </>
  );
}
