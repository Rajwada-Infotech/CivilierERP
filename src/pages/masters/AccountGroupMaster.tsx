import React, { useState, useMemo } from "react";
import { GroupTreePicker } from "@/components/common/GroupTreePicker";
import { usePageRights } from "@/hooks/usePageRights";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getAccountGroups,
  addAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
  AccountGroupDeleteError,
} from "@/api/accountApi";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  Check,
  FolderOpen,
  Folder,
  Hash,
  RotateCcw,
  Plus,
  Search,
  Layers,
  Eye,
  XCircle,
  AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

interface TreeNode extends AccountGroup {
  children: TreeNode[];
}

// ─── Tree Helpers ─────────────────────────────────────────────────────────────

function buildTree(items: AccountGroup[]): TreeNode[] {
  const map: Record<string, TreeNode> = {};
  items.forEach((i) => (map[i._id] = { ...i, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId])
      map[i.parentId].children.push(map[i._id]);
    else roots.push(map[i._id]);
  });
  return roots;
}

function getDescendants(id: string, items: AccountGroup[]): string[] {
  const out: string[] = [];
  const visit = (pid: string) =>
    items.forEach((i) => {
      if (i.parentId === pid) {
        out.push(i._id);
        visit(i._id);
      }
    });
  visit(id);
  return out;
}

/**
 * Returns the full ancestry path for display in the "Belongs To" column.
 * e.g. for "Stationery" under "Office Expense" under "Expenses":
 *   returns "Expenses / Office Expense"
 * (The group's own name is NOT included — only its ancestors)
 */
function getBelongsTo(id: string, items: AccountGroup[]): string {
  const map: Record<string, AccountGroup> = {};
  items.forEach((i) => (map[i._id] = i));
  const chain: string[] = [];
  let current = map[id];
  while (current?.parentId && map[current.parentId]) {
    current = map[current.parentId];
    chain.unshift(current.name);
  }
  return chain.join(" / ");
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", code: "", parentId: "" };

// ─── TreeRow Component ────────────────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  deleteConfirm,
  setDeleteConfirm,
  activeEditId,
  allGroups,
  onView,
  canEdit,
  canDelete,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (g: AccountGroup) => void;
  onDelete: (id: string) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  activeEditId: string | null;
  allGroups: AccountGroup[];
  onView: (g: AccountGroup) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node._id);
  const belongsTo = getBelongsTo(node._id, allGroups);

  return (
    <>
      <tr
        className={`group border-b border-border transition-colors cursor-pointer ${
          activeEditId === node._id ? "bg-primary/5" : "hover:bg-muted/30"
        }`}
        onClick={() => {
          if (hasChildren) onToggle(node._id);
          else onEdit(node);
        }}
      >
        {/* Group Name */}
        <td className="py-2.5 px-4">
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: depth * 28 }}
          >
            <div
              className={`w-5 h-5 flex items-center justify-center rounded text-muted-foreground transition-colors ${
                hasChildren
                  ? "hover:text-foreground hover:bg-muted"
                  : "opacity-0 pointer-events-none"
              }`}
            >
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
            {depth > 0 && (
              <span className="text-muted-foreground/30 text-xs">└</span>
            )}
            {hasChildren ? (
              <FolderOpen size={15} className="text-amber-500 shrink-0" />
            ) : depth === 0 ? (
              <Layers size={14} className="text-primary/60 shrink-0" />
            ) : (
              <Folder size={14} className="text-muted-foreground/40 shrink-0" />
            )}
            <span
              className={`text-sm ${
                depth === 0
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/80"
              }`}
            >
              {node.name}
            </span>
            {hasChildren && (
              <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-medium">
                {node.children.length}
              </span>
            )}
          </div>
        </td>

        {/* Code */}
        <td className="py-2.5 px-4">
          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Hash size={10} />
            {node.code || "—"}
          </span>
        </td>

        {/* Belongs To */}
        <td className="py-2.5 px-4">
          {belongsTo ? (
            <span className="text-xs text-muted-foreground font-medium">
              {belongsTo}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/30">—</span>
          )}
        </td>

        <td className="py-2.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onView(node)}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={13} />
            </button>
            {canEdit && (
              <button
                onClick={() => onEdit(node)}
                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <Pencil size={13} />
              </button>
            )}
            {deleteConfirm === node._id ? (
              <>
                <button
                  onClick={() => onDelete(node._id)}
                  className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X size={13} />
                </button>
              </>
            ) : canDelete ? (
              <button
                onClick={() => setDeleteConfirm(node._id)}
                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </div>
        </td>
      </tr>

      {isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child._id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            activeEditId={activeEditId}
            allGroups={allGroups}
            onView={onView}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        ))}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const AccountGroupMaster: React.FC = () => {
  const rights = usePageRights("account-head");
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 5 * 60 * 1000,
  });

  const allGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(dbData)) return [];
    return (dbData as any[]).map((item) => ({
      _id: String(item.AGId),
      name: item.Name || "",
      code: item.Code || "",
      parentId: item.ParentGroupId ? String(item.ParentGroupId) : null,
    }));
  }, [dbData]);

  const tree = useMemo(() => buildTree(allGroups), [allGroups]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedGroupId] = useState<string | null>(null);
  const [viewRecord, setViewRecord] = useState<AccountGroup | null>(null);

  useQuery({
    queryKey: ["account-head", "GL", selectedGroupId],
    queryFn: async () => {
      if (!selectedGroupId) return [];
      const res = await fetchWithAuth(
        `/api/account-head?type=GL&groupId=${selectedGroupId}`,
      );
      if (!res.ok) throw new Error("Failed to load GL accounts");
      return res.json().catch(() => ({}));
    },
    enabled: !!selectedGroupId,
    staleTime: 60_000,
  });

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  const expandAll = () => setExpanded(new Set(allGroups.map((g) => g._id)));
  const collapseAll = () => setExpanded(new Set());

  const startEdit = (g: AccountGroup) => {
    setEditingId(g._id);
    setForm({ name: g.name, code: g.code, parentId: g.parentId || "" });
    setErrors({});
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const isDirty = Object.keys(form).some((k) => String((form as Record<string,unknown>)[k] ?? "") !== String((EMPTY_FORM as Record<string,unknown>)[k] ?? ""));
  const canSave = form.name.trim() !== "" && form.code.trim() !== "";

  const handleSave = async () => {
    const e: Record<string, boolean> = {};
    if (!form.name.trim()) e.name = true;
    if (!form.code.trim()) e.code = true;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        Name: form.name.trim(),
        Code: form.code.trim().toUpperCase(),
        ParentGroupId: form.parentId ? Number(form.parentId) : null,
        Status: true,
      };
      if (editingId) {
        await updateAccountGroup(editingId, payload);
        toast.success("Account group updated");
      } else {
        await addAccountGroup(payload);
        toast.success("Account group created");
      }
      await queryClient.invalidateQueries({ queryKey: ["account-groups"] });
      resetForm();
    } catch (err: any) {
      toast.error(
        friendlyErrorMessage(err, "Couldn't save this account group. Please check the details and try again."),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (getDescendants(id, allGroups).length > 0) {
      toast.error(
        "This group still has sub-groups under it. Remove or move those first, then delete this one.",
      );
      setDeleteConfirm(null);
      return;
    }
    try {
      await deleteAccountGroup(id);
      toast.success("Account group deleted.");
      setDeleteConfirm(null);
      if (editingId === id) resetForm();
      await queryClient.invalidateQueries({ queryKey: ["account-groups"] });
    } catch (err) {
      if (err instanceof AccountGroupDeleteError) {
        if (err.code === "HAS_SUBGROUPS") {
          toast.error(
            "This group still has sub-groups under it. Remove or move those first, then delete this one.",
            { duration: 5000 },
          );
        } else if (err.code === "HAS_LINKED_ACCOUNTS") {
          const { linkedType, linkedName, usedIn } = err;
          const usageLine =
            usedIn && usedIn.length
              ? `Used in: ${usedIn.map((u) => `${u.label} (${u.count})`).join(", ")}.`
              : "";
          toast.error(
            `Can't delete this group — "${linkedName}" (${linkedType}) is still assigned to it.${
              usageLine ? ` ${usageLine}` : ""
            } Reassign or remove that record first.`,
            { duration: 8000 },
          );
        } else {
          toast.error(
            friendlyErrorMessage(err, "Couldn't delete this account group. Please try again."),
          );
        }
      } else {
        toast.error(
          friendlyErrorMessage(err, "Couldn't delete this account group. Please try again."),
        );
      }
      setDeleteConfirm(null);
    }
  };

  // Exclude current group + its descendants from parent options
  const invalidParents = useMemo(
    () =>
      new Set(
        editingId ? [editingId, ...getDescendants(editingId, allGroups)] : [],
      ),
    [editingId, allGroups],
  );

  // Filter the tree to remove invalid options (self + descendants)
  const filteredTree = useMemo(() => {
    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter((n) => !invalidParents.has(n._id))
        .map((n) => ({ ...n, children: filterNodes(n.children) }));
    return filterNodes(tree);
  }, [tree, invalidParents]);

  const filteredFlat = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return allGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q),
    );
  }, [search, allGroups]);

  const rootCount = allGroups.filter((g) => !g.parentId).length;
  const subCount = allGroups.filter((g) => g.parentId).length;

  // Preview the full path of the selected parent
  const selectedParentPath = useMemo(() => {
    if (!form.parentId) return null;
    const parent = allGroups.find((g) => g._id === form.parentId);
    if (!parent) return null;
    const ancestry = getBelongsTo(form.parentId, allGroups);
    return ancestry ? `${ancestry} / ${parent.name}` : parent.name;
  }, [form.parentId, allGroups]);

  return (
    <>
      <Breadcrumbs items={["Masters", "Account Group"]} />

      <FinanceShell
        title="Account Group Master"
        subtitle="Organise accounts into parent groups and sub-groups"
        action={
          <span
            className="text-xs font-heading px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" }}
          >
            {rootCount} Parent · {subCount} Sub
          </span>
        }
      >

        {/* ── Form card ── */}
        {(rights.canCreate || rights.canEdit) && <div
          className="rounded-xl overflow-visible relative"
          style={{
            background: isDark ? "rgba(12,14,22,0.55)" : "rgba(255,255,255,0.82)",
            border: isDark ? "1px solid rgba(99,102,241,0.20)" : "1px solid rgba(99,102,241,0.16)",
            backdropFilter: "blur(18px) saturate(150%)",
            WebkitBackdropFilter: "blur(18px) saturate(150%)",
            boxShadow: isDark
              ? "0 8px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 8px 32px rgba(99,102,241,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
            zIndex: 10,
          }}
        >
          {/* Card header — title only */}
          <div
            className="flex items-center gap-3 px-5 sm:px-6 py-4 relative overflow-hidden rounded-t-xl"
            style={{
              background: isDark ? "rgba(99,102,241,0.09)" : "rgba(99,102,241,0.05)",
              borderBottom: isDark ? "1px solid rgba(99,102,241,0.18)" : "1px solid rgba(99,102,241,0.13)",
            }}
          >
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground">
                {editingId ? "Edit Account Group" : "Add Account Group"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are required
              </p>
            </div>
          </div>

          {/* Form body */}
          <div className="px-5 sm:px-6 py-6 space-y-7">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Layers size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Group Details
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                {/* Group Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Group Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, name: e.target.value }));
                      setErrors((p) => ({ ...p, name: false }));
                    }}
                    placeholder="e.g. Office Expenses"
                    className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                      errors.name ? "border-red-400" : "border-border"
                    }`}
                  />
                  {errors.name && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Code <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.code}
                    onChange={(e) => {
                      setForm((p) => ({
                        ...p,
                        code: e.target.value.toUpperCase(),
                      }));
                      setErrors((p) => ({ ...p, code: false }));
                    }}
                    placeholder="e.g. EXP-OFF"
                    className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                      errors.code ? "border-red-400" : "border-border"
                    }`}
                  />
                  {errors.code && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* Parent Group */}
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Parent Group
                  </label>
                  <GroupTreePicker
                    value={form.parentId}
                    onChange={(id) => setForm((p) => ({ ...p, parentId: id }))}
                    tree={filteredTree}
                    allGroups={allGroups}
                    invalidParents={invalidParents}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {selectedParentPath ? (
                      <>
                        Will nest under:{" "}
                        <span className="font-medium text-foreground">
                          {selectedParentPath}
                        </span>
                      </>
                    ) : (
                      "Leave blank to create a top-level group"
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card footer — actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
            <p className="text-[11px] text-muted-foreground hidden sm:block">
              {canSave
                ? <span className="text-emerald-500 font-medium">Ready to save</span>
                : "Fill in the required fields to save"}
            </p>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                onClick={resetForm}
                disabled={!isDirty && !editingId}
                className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {saving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}
                {saving ? "Saving…" : editingId ? "Update Group" : "Save Group"}
              </button>
            </div>
          </div>
        </div>}

        {/* ── Table ── */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="w-full text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>
            {!search && (
              <div className="flex gap-2">
                <button
                  onClick={expandAll}
                  className="text-xs font-heading text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  Expand All
                </button>
                <button
                  onClick={collapseAll}
                  className="text-xs font-heading text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading groups…
              </div>
            ) : error ? (
              <div className="text-center py-16 text-destructive text-sm">
                Failed to load. Check backend connection.
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                      Group Name
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                      Code
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                      Belongs To
                    </th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFlat ? (
                    filteredFlat.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-10 text-center text-muted-foreground text-sm"
                        >
                          No results for "{search}"
                        </td>
                      </tr>
                    ) : (
                      filteredFlat.map((g) => {
                        const belongsTo = getBelongsTo(g._id, allGroups);
                        return (
                          <tr
                            key={g._id}
                            className={`group border-b border-border hover:bg-muted/30 transition-colors ${
                              editingId === g._id ? "bg-primary/5" : ""
                            }`}
                          >
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-2">
                                <Folder
                                  size={14}
                                  className="text-muted-foreground/40 shrink-0"
                                />
                                <span className="text-sm font-medium text-foreground">
                                  {g.name}
                                </span>
                                {g.parentId && (
                                  <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                                    sub
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                                <Hash size={10} />
                                {g.code || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              {belongsTo ? (
                                <span className="text-xs text-muted-foreground font-medium">
                                  {belongsTo}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/30">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setViewRecord(g)}
                                  className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10 transition-colors"
                                  title="View details"
                                >
                                  <Eye size={13} />
                                </button>
                                {rights.canEdit && (
                                  <button
                                    onClick={() => startEdit(g)}
                                    className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                )}
                                {deleteConfirm === g._id ? (
                                  <>
                                    <button
                                      onClick={() => handleDelete(g._id)}
                                      className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                                    >
                                      <Check size={13} />
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirm(null)}
                                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                    >
                                      <X size={13} />
                                    </button>
                                  </>
                                ) : rights.canDelete ? (
                                  <button
                                    onClick={() => setDeleteConfirm(g._id)}
                                    className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )
                  ) : tree.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-14 text-muted-foreground text-sm"
                      >
                        <Layers size={18} className="mx-auto mb-2 opacity-30" />
                        No account groups yet. Use the form above to create your
                        first group.
                      </td>
                    </tr>
                  ) : (
                    tree.map((node) => (
                      <TreeRow
                        key={node._id}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        onToggle={toggleExpand}
                        onEdit={startEdit}
                        onDelete={handleDelete}
                        deleteConfirm={deleteConfirm}
                        setDeleteConfirm={setDeleteConfirm}
                        activeEditId={editingId}
                        allGroups={allGroups}
                        onView={setViewRecord}
                        canEdit={rights.canEdit}
                        canDelete={rights.canDelete}
                      />
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </FinanceShell>
      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                {allGroups.some((g) => g.parentId === viewRecord._id) ? (
                  <FolderOpen size={15} className="text-amber-500" />
                ) : viewRecord.parentId ? (
                  <Folder size={15} className="text-muted-foreground" />
                ) : (
                  <Layers size={15} className="text-primary/60" />
                )}
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Account Group Details
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Group Name
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.name}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Code
                </p>
                <p className="font-mono text-sm font-semibold text-primary flex items-center gap-1">
                  <Hash size={11} />
                  {viewRecord.code || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Belongs To
                </p>
                {(() => {
                  const path = getBelongsTo(viewRecord._id, allGroups);
                  return path ? (
                    <p className="text-sm text-foreground">{path}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Top-level group
                    </p>
                  );
                })()}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Type
                </p>
                {(() => {
                  const hasChildren = allGroups.some(
                    (g) => g.parentId === viewRecord._id,
                  );
                  const isRoot = !viewRecord.parentId;
                  return (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${isRoot ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      {hasChildren ? (
                        <>
                          <FolderOpen size={10} /> Parent Group
                        </>
                      ) : isRoot ? (
                        <>
                          <Layers size={10} /> Root Group
                        </>
                      ) : (
                        <>
                          <Folder size={10} /> Sub-Group
                        </>
                      )}
                    </span>
                  );
                })()}
              </div>
              {(() => {
                const children = allGroups.filter(
                  (g) => g.parentId === viewRecord._id,
                );
                if (children.length === 0) return null;
                return (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-2">
                      Sub-Groups ({children.length})
                    </p>
                    <div className="space-y-1">
                      {children.map((c) => (
                        <div
                          key={c._id}
                          className="flex items-center gap-2 px-2 py-1 rounded-lg bg-muted/40"
                        >
                          <Folder
                            size={11}
                            className="text-muted-foreground/60 shrink-0"
                          />
                          <span className="text-xs text-foreground flex-1">
                            {c.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {c.code}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-muted/20">
              <button
                onClick={() => setViewRecord(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  startEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit Group
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AccountGroupMaster;
