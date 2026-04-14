import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAccountGroups,
  addAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from "@/api/accountApi";
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

/**
 * Flattens the tree into an ordered list for the parent dropdown,
 * preserving hierarchy order with depth info for visual indentation.
 */
function flattenForDropdown(
  nodes: TreeNode[],
  depth = 0,
): { group: AccountGroup; depth: number }[] {
  const result: { group: AccountGroup; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ group: node, depth });
    if (node.children.length > 0) {
      result.push(...flattenForDropdown(node.children, depth + 1));
    }
  }
  return result;
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
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node._id);
  const belongsTo = getBelongsTo(node._id, allGroups);

  return (
    <>
      <tr
        className={`group border-b border-border transition-colors ${
          activeEditId === node._id ? "bg-primary/5" : "hover:bg-muted/30"
        }`}
      >
        {/* Group Name */}
        <td className="py-2.5 px-4">
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: depth * 28 }}
          >
            <button
              onClick={() => hasChildren && onToggle(node._id)}
              className={`w-5 h-5 flex items-center justify-center rounded text-muted-foreground transition-colors ${
                hasChildren
                  ? "hover:text-foreground hover:bg-muted cursor-pointer"
                  : "opacity-0 cursor-default"
              }`}
            >
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
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

        {/* Actions */}
        <td className="py-2.5 px-4 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(node)}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Pencil size={13} />
            </button>
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
            ) : (
              <button
                onClick={() => setDeleteConfirm(node._id)}
                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
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
          />
        ))}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const AccountGroupMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
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

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
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
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (getDescendants(id, allGroups).length > 0) {
      toast.error("Remove sub-groups before deleting a parent group");
      setDeleteConfirm(null);
      return;
    }
    try {
      await deleteAccountGroup(id);
      toast.success("Deleted");
      setDeleteConfirm(null);
      if (editingId === id) resetForm();
      await queryClient.invalidateQueries({ queryKey: ["account-groups"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
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

  // Filter the tree to remove invalid options, then flatten in hierarchy order
  const dropdownOptions = useMemo(() => {
    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter((n) => !invalidParents.has(n._id))
        .map((n) => ({ ...n, children: filterNodes(n.children) }));
    return flattenForDropdown(filterNodes(tree));
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

      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Account Group Master
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Organise accounts into parent groups and sub-groups
        </p>
      </div>

      {/* ── Form card ── */}
      <div className="rounded-xl border border-border bg-card mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {editingId ? "Edit Group" : "Add Account Group"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {editingId
              ? "Modify the selected group"
              : "Fill in the details to create a new group."}
          </p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {/* Group Name */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                GROUP NAME <span className="text-red-500">*</span>
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
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Code */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                CODE <span className="text-red-500">*</span>
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
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Parent Group — hierarchical dropdown */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                PARENT GROUP
              </label>
              <select
                value={form.parentId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, parentId: e.target.value }))
                }
                className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              >
                <option value="">— Top-level group (no parent)</option>
                {dropdownOptions.map(({ group, depth }) => (
                  <option key={group._id} value={group._id}>
                    {"\u00a0\u00a0\u00a0\u00a0".repeat(depth)}
                    {depth > 0 ? "└ " : ""}
                    {group.name}
                    {group.code ? ` (${group.code})` : ""}
                  </option>
                ))}
              </select>
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

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center gap-2"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : editingId ? (
                <>
                  <Check size={14} />
                  Update Group
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Save Group
                </>
              )}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-5 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <RotateCcw size={13} />
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search
              size={14}
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
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
              >
                Collapse All
              </button>
            </div>
          )}
          <div className="ml-auto flex gap-2 text-xs text-muted-foreground">
            <span className="bg-muted/60 rounded-lg px-3 py-1.5">
              {rootCount} Parent Groups
            </span>
            <span className="bg-muted/60 rounded-lg px-3 py-1.5">
              {subCount} Sub-Groups
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden bg-card">
          {isLoading ? (
            <div className="p-10 text-center">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading groups…</p>
            </div>
          ) : error ? (
            <div className="p-10 text-center">
              <p className="text-red-500 text-sm">
                Failed to load. Check backend connection.
              </p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4">
                    Group Name
                  </th>
                  <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4">
                    Code
                  </th>
                  <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4">
                    Belongs To
                  </th>
                  <th className="py-3 px-4 w-24" />
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
                                onClick={() => startEdit(g)}
                                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Pencil size={13} />
                              </button>
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
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(g._id)}
                                  className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )
                ) : tree.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center">
                      <Layers
                        size={28}
                        className="text-muted-foreground/30 mx-auto mb-3"
                      />
                      <p className="text-sm text-muted-foreground">
                        No account groups yet.
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Use the form above to create your first group.
                      </p>
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
                    />
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
};

export default AccountGroupMaster;
