import React, { useState, useMemo } from "react";
import { GroupTreePicker } from "@/components/common/GroupTreePicker";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
import { AccountGroupAuditTrailModal } from "./components/AccountGroupAuditTrailModal";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { ChevronRight, ChevronDown, Pencil, Trash2, X, Check, RotateCcw, Plus, Search, Eye, History } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";

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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

// ─── Row actions (shared by the tree and the search results) ─────────────────

function RowActions({
  group, onView, onEdit, onDelete, deleteConfirm, setDeleteConfirm, canEdit, canDelete,
}: {
  group: AccountGroup;
  onView: (g: AccountGroup) => void;
  onEdit: (g: AccountGroup) => void;
  onDelete: (id: string) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button data-row-view onClick={() => onView(group)} className={ACT} title="View details" aria-label="View details">
        <Eye size={13} />
      </button>
      {canEdit && (
        <button onClick={() => onEdit(group)} className={ACT} title="Edit" aria-label="Edit">
          <Pencil size={13} />
        </button>
      )}
      {deleteConfirm === group._id ? (
        <>
          <button
            onClick={() => onDelete(group._id)}
            className="h-7 px-2 flex items-center gap-1 border border-destructive bg-destructive text-destructive-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]"
            title="Confirm delete"
          >
            <Check size={12} /> Delete
          </button>
          <button onClick={() => setDeleteConfirm(null)} className={ACT} title="Keep" aria-label="Keep">
            <X size={13} />
          </button>
        </>
      ) : canDelete ? (
        <button
          onClick={() => setDeleteConfirm(group._id)}
          className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
          title="Delete"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}

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
  // A top-level group opens on an ink rule; the group being edited carries a rule on its left.
  const shadows = [
    depth === 0 ? "inset 0 1px 0 hsl(var(--foreground))" : null,
    activeEditId === node._id ? "inset 3px 0 0 hsl(var(--primary))" : null,
  ].filter(Boolean).join(", ");

  return (
    <>
      <tr
        className="cursor-pointer"
        style={shadows ? { boxShadow: shadows } : undefined}
        onClick={() => {
          if (hasChildren) onToggle(node._id);
          else onEdit(node);
        }}
      >
        {/* Group Name */}
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 22 }}>
            <span className={`w-4 h-4 flex items-center justify-center text-foreground shrink-0 ${hasChildren ? "" : "opacity-0"}`}>
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span
              className={
                depth === 0
                  ? "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-foreground"
                  : hasChildren
                    ? "text-[0.8125rem] font-semibold text-foreground"
                    : "text-[0.8125rem] text-foreground"
              }
            >
              {node.name}
            </span>
            {hasChildren && (
              <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground">{node.children.length}</span>
            )}
          </div>
        </td>

        {/* Code */}
        <td className="py-2.5 px-4">
          <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{node.code || "—"}</span>
        </td>

        {/* Belongs To */}
        <td className="py-2.5 px-4">
          <span className={`text-xs ${belongsTo ? "text-muted-foreground" : "text-muted-foreground/40"}`}>{belongsTo || "—"}</span>
        </td>

        <td className="py-1.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
          <RowActions
            group={node}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            canEdit={canEdit}
            canDelete={canDelete}
          />
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
  const [auditTrailOpen, setAuditTrailOpen] = useState(false);

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

  const accountGroupExportColumns: ExportColumn[] = useMemo(
    () => [
      { header: "Group Name", accessor: "name" },
      { header: "Code", accessor: "code" },
      {
        header: "Belongs To",
        accessor: (row: any) => getBelongsTo(row._id, allGroups) || "—",
      },
    ],
    [allGroups],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useDraftForm("account-group-master", EMPTY_FORM, {
    skip: editingId !== null,
  });
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

  const inputCls = (bad?: boolean) =>
    `w-full h-10 text-sm px-3 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none border ${
      bad ? "border-destructive" : "border-foreground/40 focus:border-foreground"
    }`;

  return (
    <>
      <Breadcrumbs items={["Masters", "Account Group"]} />

      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Account groups"
        subtitle="The tree every account sits in: parent groups, and the sub-groups under them."
        action={
          <button
            type="button"
            onClick={() => setAuditTrailOpen(true)}
            className={`${KEY} px-3 py-2 text-foreground border border-foreground hover:bg-primary/10`}
          >
            <History size={13} /> Audit trail
          </button>
        }
      >
        {/* ── Figures ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Groups", value: allGroups.length, note: "in all" },
              { label: "Top-level", value: rootCount, note: "parent groups" },
              { label: "Sub-groups", value: subCount, note: "nested under a parent" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form ── */}
        {(rights.canCreate || rights.canEdit) && (
          <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
              <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                {editingId ? "Edit account group" : "Add account group"}
              </h2>
              <p className="text-[0.6875rem] text-muted-foreground">
                Fields marked <span className="text-destructive">*</span> are required
              </p>
            </div>

            <div className="px-4 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              {/* Group Name */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Group name <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, name: e.target.value }));
                    setErrors((p) => ({ ...p, name: false }));
                  }}
                  placeholder="e.g. Office Expenses"
                  className={inputCls(errors.name)}
                />
                {errors.name && <p className="text-xs text-destructive mt-1">Required</p>}
              </div>

              {/* Code */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
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
                  className={`${inputCls(errors.code)} font-heading font-semibold tabular-nums tracking-wide`}
                />
                {errors.code && <p className="text-xs text-destructive mt-1">Required</p>}
              </div>

              {/* Parent Group */}
              <div className="sm:col-span-2">
                <label className={`${LBL} block mb-1.5`}>Parent group</label>
                <GroupTreePicker
                  value={form.parentId}
                  onChange={(id) => setForm((p) => ({ ...p, parentId: id }))}
                  tree={filteredTree}
                  allGroups={allGroups}
                  invalidParents={invalidParents}
                />
                <p className="text-[0.6875rem] text-muted-foreground mt-1.5">
                  {selectedParentPath ? (
                    <>
                      Will sit under <span className="font-semibold text-foreground">{selectedParentPath}</span>
                    </>
                  ) : (
                    "Leave blank to create a top-level group"
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3" style={{ borderTop: RULE }}>
              <div className="hidden sm:block">
                {canSave ? <SheetMark text="Ready to save" tone="done" /> : <span className="text-[0.6875rem] text-muted-foreground">Fill in the required fields to save</span>}
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  onClick={resetForm}
                  disabled={!isDirty && !editingId}
                  className={`${KEY} flex-1 sm:flex-none h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
                >
                  <RotateCcw size={12} />
                  {editingId ? "Cancel" : "Reset"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className={`${KEY} flex-1 sm:flex-none h-9 px-5 bg-foreground text-card border border-foreground whitespace-nowrap`}
                >
                  {saving ? (
                    <span className="w-3.5 h-3.5 border-2 border-card/30 border-t-card rounded-full animate-spin" />
                  ) : editingId ? (
                    <Check size={13} />
                  ) : (
                    <Plus size={13} />
                  )}
                  {saving ? "Saving…" : editingId ? "Update group" : "Save group"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── The tree ── */}
        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="w-full h-9 text-sm border border-foreground/40 focus:border-foreground pl-9 pr-3 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            {!search && (
              <div className="seg">
                <button onClick={expandAll}>Expand all</button>
                <button onClick={collapseAll}>Collapse</button>
              </div>
            )}
            <div className="ml-auto">
              <ExportMenu
                data={allGroups as unknown as Record<string, unknown>[]}
                columns={accountGroupExportColumns}
                title="Account Group Master"
                filename="account-group-master"
                disabled={!rights.canExport || allGroups.length === 0}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <div className="w-5 h-5 border-2 border-foreground border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              Loading groups…
            </div>
          ) : error ? (
            <div className="text-center py-16 text-destructive text-sm">Failed to load. Check backend connection.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[560px]">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5 text-left">Group</th>
                    <th className="px-4 py-2.5 text-left w-40">Code</th>
                    <th className="px-4 py-2.5 text-left">Belongs to</th>
                    <th className="px-4 py-2.5 w-36" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFlat ? (
                    filteredFlat.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-muted-foreground text-sm">
                          No results for "{search}"
                        </td>
                      </tr>
                    ) : (
                      filteredFlat.map((g) => {
                        const belongsTo = getBelongsTo(g._id, allGroups);
                        return (
                          <tr key={g._id} style={editingId === g._id ? { boxShadow: "inset 3px 0 0 hsl(var(--primary))" } : undefined}>
                            <td className="py-2.5 px-4">
                              <div className="flex items-baseline gap-2.5">
                                <span className="text-[0.8125rem] font-medium text-foreground">{g.name}</span>
                                <span className={LBL}>{g.parentId ? "Sub-group" : "Top-level"}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{g.code || "—"}</span>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`text-xs ${belongsTo ? "text-muted-foreground" : "text-muted-foreground/40"}`}>{belongsTo || "—"}</span>
                            </td>
                            <td className="py-1.5 px-4 text-right">
                              <RowActions
                                group={g}
                                onView={setViewRecord}
                                onEdit={startEdit}
                                onDelete={handleDelete}
                                deleteConfirm={deleteConfirm}
                                setDeleteConfirm={setDeleteConfirm}
                                canEdit={rights.canEdit}
                                canDelete={rights.canDelete}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )
                  ) : tree.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-14 text-muted-foreground text-sm">
                        No account groups yet. Use the form above to create your first group.
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
            </div>
          )}
        </div>
      </SheetShell>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (() => {
        const children = allGroups.filter((g) => g.parentId === viewRecord._id);
        const path = getBelongsTo(viewRecord._id, allGroups);
        const kind = children.length > 0 ? "Parent group" : viewRecord.parentId ? "Sub-group" : "Top-level group";
        return (
          <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setViewRecord(null)} />
            <div
              className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200"
              style={{ margin: 0, borderLeft: RULE }}
            >
              <div className="flex items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
                <div className="min-w-0">
                  <p className={LBL}>Account group · {kind}</p>
                  <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 break-words">{viewRecord.name}</h3>
                </div>
                <button onClick={() => setViewRecord(null)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-5 overflow-y-auto flex-1">
                <div>
                  <p className={LBL}>Code</p>
                  <p className="font-heading text-sm font-semibold tabular-nums text-foreground mt-1">{viewRecord.code || "—"}</p>
                </div>
                <div>
                  <p className={LBL}>Belongs to</p>
                  <p className={`text-sm mt-1 ${path ? "text-foreground" : "text-muted-foreground"}`}>{path || "Nothing: this is a top-level group"}</p>
                </div>
                {children.length > 0 && (
                  <div>
                    <p className={LBL}>Sub-groups · {children.length}</p>
                    <div className="mt-2" style={{ borderTop: RULE }}>
                      {children.map((c) => (
                        <div key={c._id} className="flex items-baseline gap-3 py-2" style={{ borderBottom: "1px solid hsl(var(--border) / 0.7)" }}>
                          <span className="text-xs text-foreground flex-1 min-w-0 break-words">{c.name}</span>
                          <span className="font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground shrink-0">{c.code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
                <button onClick={() => setViewRecord(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                  Close
                </button>
                {rights.canEdit && (
                  <button
                    onClick={() => {
                      startEdit(viewRecord);
                      setViewRecord(null);
                    }}
                    className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}
                  >
                    <Pencil size={12} /> Edit group
                  </button>
                )}
              </div>
            </div>
          </div></BodyPortal>
        );
      })()}

      <AccountGroupAuditTrailModal open={auditTrailOpen} onClose={() => setAuditTrailOpen(false)} />
    </>
  );
};

export default AccountGroupMaster;
