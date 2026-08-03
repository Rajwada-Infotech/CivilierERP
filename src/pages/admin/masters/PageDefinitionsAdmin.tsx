// src/pages/admin/masters/PageDefinitionsAdmin.tsx
// Admin UI for dbo.PageDefinitions — the DB-backed replacement for the
// hardcoded PAGE_DEFINITIONS array in MenuRights.tsx.
//
// Features:
//   • List all page definitions (active + inactive) with search + module filter
//   • Add / Edit drawer — pageKey, label, module, groupName, actions checkboxes, sortOrder
//   • Soft-delete (deactivate) with confirm
//   • Active toggle via inline badge click
//   • Stats strip: Total / Active / Inactive

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  LayoutGrid,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Loader2,
  Search,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";

// ── Types ─────────────────────────────────────────────────────────────────────

type PageAction = "view" | "create" | "edit" | "delete" | "print" | "export";

interface PageDef {
  id: number;
  key: string;
  label: string;
  module: string;
  group: string;
  actions: PageAction[];
  sortOrder: number;
  isActive: boolean;
}

interface FormState {
  key: string;
  label: string;
  module: string;
  group: string;
  actions: PageAction[];
  sortOrder: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_ACTIONS: { key: PageAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "export", label: "Export" },
];

const MODULE_OPTIONS = [
  "General",
  "Finance",
  "Material",
  "Engineering",
  "Follow-Up",
  "Ticket",
  "Masters",
  "Reports",
];

const MODULE_COLORS: Record<string, string> = {
  General: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  Finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Material: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Engineering: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Follow-Up": "bg-teal-500/10 text-teal-600 border-teal-500/20",
  Ticket: "bg-red-500/10 text-red-400 border-red-500/20",
  Masters: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Reports: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

const emptyForm: FormState = {
  key: "",
  label: "",
  module: "General",
  group: "",
  actions: ["view"],
  sortOrder: "100",
};

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchAll(): Promise<PageDef[]> {
  const res = await fetchWithAuth("/api/page-definitions/all");
  if (!res.ok) throw new Error("Failed to fetch page definitions");
  const json = await res.json().catch(() => ({}));
  return json.data ?? [];
}

async function createDef(
  body: Omit<FormState, "sortOrder"> & { sortOrder: number; isActive: boolean },
) {
  const res = await fetchWithAuth("/api/page-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageKey: body.key,
      label: body.label,
      module: body.module,
      groupName: body.group,
      actions: body.actions,
      sortOrder: body.sortOrder,
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Create failed");
  }
}

async function updateDef(
  id: number,
  body: Omit<FormState, "sortOrder"> & { sortOrder: number; isActive: boolean },
) {
  const res = await fetchWithAuth(`/api/page-definitions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageKey: body.key,
      label: body.label,
      module: body.module,
      groupName: body.group,
      actions: body.actions,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Update failed");
  }
}

async function deleteDef(id: number) {
  const res = await fetchWithAuth(`/api/page-definitions/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Delete failed");
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PageDefinitionsAdmin() {
  const qc = useQueryClient();
  const rights = usePageRights("page-definitions");

  // Real-time fetch: this admin screen must always reflect the live DB —
  // other admins/sessions can add or change page definitions at any time,
  // and the Menu Rights screen depends on this list being accurate. The
  // app-wide queryClient default (staleTime: 60s, refetchOnWindowFocus:
  // false) would silently serve a stale snapshot for up to a minute on
  // remount, so every relevant refetch trigger is forced on here instead
  // of relying on those global defaults.
  const {
    data: rows = [],
    isLoading,
    isFetching,
  } = useQuery<PageDef[]>({
    queryKey: ["page-definitions-all"],
    queryFn: fetchAll,
    staleTime: 0, // always considered stale → every mount refetches
    gcTime: 0, // don't keep a cached snapshot around between visits
    refetchOnMount: "always", // ignore cache even if a fresh-looking entry exists
    refetchOnWindowFocus: true, // catch changes made by another admin in another tab
    refetchOnReconnect: true,
  });

  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<PageDef | null>(null);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => r.isActive).length,
      inactive: rows.filter((r) => !r.isActive).length,
    }),
    [rows],
  );

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (moduleFilter === "All" || r.module === moduleFilter) &&
        (r.key.toLowerCase().includes(q) ||
          r.label.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q)),
    );
  }, [rows, search, moduleFilter]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["page-definitions-all"] });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        sortOrder: parseInt(form.sortOrder) || 100,
        isActive: true,
      };
      if (editingId !== null) {
        const existing = rows.find((r) => r.id === editingId);
        await updateDef(editingId, {
          ...payload,
          isActive: existing?.isActive ?? true,
        });
      } else {
        await createDef(payload);
      }
    },
    onSuccess: () => {
      toast.success(
        editingId !== null
          ? "Page definition updated"
          : "Page definition created",
      );
      closeDrawer();
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async ({
      row,
      newActive,
    }: {
      row: PageDef;
      newActive: boolean;
    }) => {
      await updateDef(row.id, {
        key: row.key,
        label: row.label,
        module: row.module,
        group: row.group,
        actions: row.actions,
        sortOrder: row.sortOrder,
        isActive: newActive,
      });
    },
    onSuccess: (_, { newActive }) => {
      toast.success(newActive ? "Page activated" : "Page deactivated");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDef(id),
    onSuccess: () => {
      toast.success("Page definition deactivated");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Drawer helpers ─────────────────────────────────────────────────────────
  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function openEdit(row: PageDef) {
    setEditingId(row.id);
    setForm({
      key: row.key,
      label: row.label,
      module: row.module,
      group: row.group,
      actions: row.actions,
      sortOrder: String(row.sortOrder),
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function toggleAction(a: PageAction) {
    setForm((f) => ({
      ...f,
      actions: f.actions.includes(a)
        ? f.actions.filter((x) => x !== a)
        : [...f.actions, a],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.key.trim() || !form.label.trim() || !form.group.trim()) {
      toast.error("Page key, label and group are required");
      return;
    }
    if (form.actions.length === 0) {
      toast.error("At least one action must be selected");
      return;
    }
    saveMut.mutate();
  }

  const modules = useMemo(
    () => ["All", ...Array.from(new Set<string>(rows.map((r) => r.module)))],
    [rows],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Admin" },
          { label: "Masters" },
          { label: "Page Definitions" },
        ]}
      />

      <AdminShell
        title="Page Definitions"
        subtitle={
          <>
            Manage which pages appear in Menu Rights without a code deploy
            {isFetching && !isLoading && (
              <span className="inline-flex items-center gap-1 ml-2 text-[10px] font-medium text-muted-foreground">
                <RefreshCw size={10} className="animate-spin" /> Syncing…
              </span>
            )}
          </>
        }
        icon={LayoutGrid}
        action={
          rights.canCreate && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
            >
              <Plus size={13} /> Add Page
            </button>
          )
        }
      >
        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Active", value: stats.active, color: "text-emerald-500" },
            {
              label: "Inactive",
              value: stats.inactive,
              color: "text-muted-foreground",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-card border border-border rounded-xl px-4 py-3"
            >
              <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wide">
                {s.label}
              </p>
              <p className={`text-xl font-heading font-bold mt-0.5 ${s.color}`}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key, label, group…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {modules.map((m) => (
              <button
                key={m}
                onClick={() => setModuleFilter(m)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition ${
                  moduleFilter === m
                    ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-transparent shadow-sm"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No page definitions found
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Key
                  </th>
                  <th className="px-4 py-2.5 text-left font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Label
                  </th>
                  <th className="px-4 py-2.5 text-left font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Module / Group
                  </th>
                  <th className="px-4 py-2.5 text-left font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Actions
                  </th>
                  <th className="px-4 py-2.5 text-center font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Order
                  </th>
                  <th className="px-4 py-2.5 text-center font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-center font-heading font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const colorClass =
                    MODULE_COLORS[row.module] ??
                    "bg-muted text-muted-foreground border-muted";
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${!row.isActive ? "opacity-50" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-[11px] text-primary font-semibold">
                        {row.key}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-body text-foreground">
                        {row.label}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}
                        >
                          {row.module}
                        </span>
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          {row.group}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {row.actions.map((a) => (
                            <span
                              key={a}
                              className="px-1.5 py-0.5 rounded text-[9px] bg-primary/10 text-primary font-medium capitalize"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center text-muted-foreground">
                        {row.sortOrder}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() =>
                            toggleActiveMut.mutate({
                              row,
                              newActive: !row.isActive,
                            })
                          }
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border transition ${
                            row.isActive
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                              : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                          }`}
                        >
                          {row.isActive ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {rights.canEdit && (
                            <button
                              onClick={() => openEdit(row)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                              title="Edit"
                            >
                              <Edit size={12} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button
                              onClick={() => setDeleteTarget(row)}
                              disabled={!row.isActive}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Deactivate"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </AdminShell>

      {/* ── Add / Edit Drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={closeDrawer}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <LayoutGrid size={14} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  {editingId !== null
                    ? "Edit Page Definition"
                    : "New Page Definition"}
                </h3>
              </div>
              <button
                onClick={closeDrawer}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X size={14} />
              </button>
            </div>

            {/* Drawer body */}
            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto p-5 space-y-4"
            >
              {/* Page Key */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Page Key <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, key: e.target.value }))
                  }
                  placeholder="e.g. purchase-orders"
                  disabled={editingId !== null} // key is immutable after create
                  className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Must match the route key used in permission checks. Cannot be
                  changed after creation.
                </p>
              </div>

              {/* Label */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Display Label <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="e.g. Purchase Orders"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>

              {/* Module */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Module <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={form.module}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, module: e.target.value }))
                    }
                    className="w-full appearance-none px-3 py-2 pr-8 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    {MODULE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {!MODULE_OPTIONS.includes(form.module) && (
                      <option value={form.module}>{form.module}</option>
                    )}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>

              {/* Group */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Group Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.group}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, group: e.target.value }))
                  }
                  placeholder="e.g. Finance & Accounts"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Pages with the same group name are shown under the same
                  heading in Menu Rights.
                </p>
              </div>

              {/* Actions */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Allowed Actions <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_ACTIONS.map((a) => {
                    const checked = form.actions.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => toggleAction(a.key)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition ${
                          checked
                            ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-transparent shadow-sm"
                            : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                        }`}
                      >
                        {checked && <Check size={9} />} {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sort Order */}
              <div>
                <label className="block text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                  min={1}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Lower numbers appear first within their group.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="flex-1 border border-border py-2.5 rounded-lg text-sm font-heading hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveMut.isPending}
                  className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white py-2.5 rounded-lg text-sm font-heading disabled:opacity-60 flex items-center justify-center gap-2 transition-all"
                >
                  {saveMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {saveMut.isPending
                    ? "Saving…"
                    : editingId !== null
                      ? "Update"
                      : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                <AlertTriangle size={16} className="text-amber-500" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Deactivate Page Definition?
                </h3>
                <p className="text-xs text-muted-foreground mt-1 font-body">
                  <span className="font-mono font-semibold text-foreground">
                    {deleteTarget.key}
                  </span>{" "}
                  will be hidden from Menu Rights. Existing user permissions for
                  this page are preserved but won't take effect.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-border py-2 rounded-lg text-sm font-heading hover:bg-muted transition"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-sm font-heading hover:bg-amber-600 disabled:opacity-60 flex items-center justify-center gap-2 transition"
              >
                {deleteMut.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
