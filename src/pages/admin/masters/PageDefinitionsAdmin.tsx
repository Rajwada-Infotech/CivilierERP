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
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
import { BodyPortal } from "@/components/ui/body-portal";

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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const INPUT = "w-full px-3 py-2 text-sm border border-foreground/40 focus:border-foreground bg-card text-foreground focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-60 disabled:cursor-not-allowed";
const CHIP = "h-7 px-2.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border transition-colors inline-flex items-center gap-1";

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

      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Page definitions"
        subtitle="Which pages appear in Menu Rights, the actions each can grant, and where they sit. Changes take effect without a code deploy."
        action={
          rights.canCreate && (
            <button onClick={openAdd} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus size={13} /> New page
            </button>
          )
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Pages", value: stats.total, note: "defined" },
              { label: "Active", value: stats.active, note: "offered in Menu Rights" },
              { label: "Inactive", value: stats.inactive, note: "hidden, permissions kept" },
            ].map((s) => (
              <div key={s.label}>
                <p className="label">{s.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : s.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5 mr-auto">
              <span className={HEAD}>Pages</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
              {isFetching && !isLoading && (
                <span className={`${LBL} inline-flex items-center gap-1`}>
                  <RefreshCw size={10} className="animate-spin" /> Syncing
                </span>
              )}
            </p>
            <div className="relative w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search key, label, group…"
                className={`${INPUT} h-9 pl-8`}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={`${LBL} self-center mr-1`}>Module</span>
            {modules.map((m) => (
              <button
                key={m}
                onClick={() => setModuleFilter(m)}
                aria-pressed={moduleFilter === m}
                className={`${CHIP} ${
                  moduleFilter === m
                    ? "bg-foreground text-card border-foreground"
                    : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No page definitions found.
            </div>
          ) : (
            <div className="overflow-x-auto thin-scroll"><table className="w-full text-xs">
              <thead>
                <tr className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground))" }}>
                  <th className="px-4 py-2.5 text-left font-semibold">Key</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Label</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Module / group</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Grants</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Order</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-primary/5 transition-colors"
                    style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.12)" }}
                  >
                    <td className={`px-4 py-2.5 font-heading text-[0.6875rem] font-semibold ${row.isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {row.key}
                    </td>
                    <td className={`px-4 py-2.5 text-sm ${row.isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {row.label}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground/40 px-1.5 py-0.5 whitespace-nowrap">
                        {row.module}
                      </span>
                      <span className="ml-1.5 text-[0.6875rem] text-muted-foreground">
                        {row.group}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[0.6875rem] text-muted-foreground capitalize">
                        {row.actions.join(" · ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-heading tabular-nums text-muted-foreground">
                      {row.sortOrder}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() =>
                          toggleActiveMut.mutate({
                            row,
                            newActive: !row.isActive,
                          })
                        }
                        title={row.isActive ? "Deactivate" : "Activate"}
                        className="hover:opacity-70 transition-opacity"
                      >
                        {row.isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        {rights.canEdit && (
                          <button onClick={() => openEdit(row)} className={ACT} title="Edit" aria-label="Edit">
                            <Edit size={12} />
                          </button>
                        )}
                        {rights.canDelete && (
                          <button
                            onClick={() => setDeleteTarget(row)}
                            disabled={!row.isActive}
                            className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Deactivate"
                            aria-label="Deactivate"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </SheetShell>

      {/* ── Add / Edit Drawer ── */}
      {drawerOpen && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={closeDrawer}
          />
          <div className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200" style={{ margin: 0, borderLeft: RULE }}>
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground">
                  {editingId !== null
                    ? "Edit Page Definition"
                    : "New Page Definition"}
                </h3>
              </div>
              <button
                onClick={closeDrawer}
                className={ACT} aria-label="Close"
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
                <label className={`${LBL} block mb-1.5`}>
                  Page Key <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, key: e.target.value }))
                  }
                  placeholder="e.g. purchase-orders"
                  disabled={editingId !== null} // key is immutable after create
                  className={`${INPUT} font-heading`}
                />
                <p className="text-[0.625rem] text-muted-foreground mt-1">
                  Must match the route key used in permission checks. Cannot be
                  changed after creation.
                </p>
              </div>

              {/* Label */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Display Label <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="e.g. Purchase Orders"
                  className={INPUT}
                />
              </div>

              {/* Module */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Module <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <select
                    value={form.module}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, module: e.target.value }))
                    }
                    className={`${INPUT} appearance-none pr-8`}
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
                <label className={`${LBL} block mb-1.5`}>
                  Group Name <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.group}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, group: e.target.value }))
                  }
                  placeholder="e.g. Finance & Accounts"
                  className={INPUT}
                />
                <p className="text-[0.625rem] text-muted-foreground mt-1">
                  Pages with the same group name are shown under the same
                  heading in Menu Rights.
                </p>
              </div>

              {/* Actions */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Allowed Actions <span className="text-destructive">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_ACTIONS.map((a) => {
                    const checked = form.actions.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => toggleAction(a.key)}
                        className={`${CHIP} ${
                          checked
                            ? "bg-foreground text-card border-foreground"
                            : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
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
                <label className={`${LBL} block mb-1.5`}>
                  Sort Order
                </label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                  className={INPUT}
                  min={1}
                />
                <p className="text-[0.625rem] text-muted-foreground mt-1">
                  Lower numbers appear first within their group.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-4" style={{ borderTop: RULE }}>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className={`${KEY_LINE} flex-1 h-9`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveMut.isPending}
                  className={`${KEY_INK} flex-1 h-9`}
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
        </div></BodyPortal>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          />
          <div className="sheet-frame relative bg-card p-6 w-full max-w-sm mx-4" style={{ margin: 0, border: RULE, boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}>
            <div>
              <div>
                <div className="pb-3 mb-3" style={{ borderBottom: RULE }}>
                  <p className={LBL}>Page definition</p>
                  <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">Deactivate page</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-body">
                  <span className="font-heading font-semibold text-foreground">
                    {deleteTarget.key}
                  </span>{" "}
                  will be hidden from Menu Rights. Existing user permissions for
                  this page are preserved but won't take effect.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className={`${KEY_LINE} flex-1 h-9`}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className={`${KEY} flex-1 h-9 bg-destructive text-destructive-foreground border border-destructive`}
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
        </div></BodyPortal>
      )}
    </>
  );
}
