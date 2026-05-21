import React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Warehouse,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  AlertCircle,
  RefreshCw,
  MapPin,
  Building2,
  Tag,
  Star,
  MoreVertical,
  Archive,
  Search,
} from "lucide-react";
import {
  getGodowns,
  createGodown,
  updateGodown,
  deleteGodown,
  type Godown,
  type CreateGodownPayload,
} from "@/api/godownsApi";

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all";

// ─── Create / Edit Drawer ─────────────────────────────────────────────────────
function GodownDrawer({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Godown | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateGodownPayload>({
    GodownName: "",
    GodownCode: "",
    ShortDesc: "",
    Description: "",
    Remarks: "",
  });
  const [err, setErr] = useState("");

  React.useEffect(() => {
    if (editing) {
      setForm({
        GodownName: editing.GodownName || "",
        GodownCode: editing.GodownCode || "",
        ShortDesc: editing.ShortDesc || "",
        Description: editing.Description || "",
        Remarks: editing.Remarks || "",
      });
    } else {
      setForm({
        GodownName: "",
        GodownCode: "",
        ShortDesc: "",
        Description: "",
        Remarks: "",
      });
    }
    setErr("");
  }, [editing, open]);

  const createMut = useMutation({
    mutationFn: createGodown,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<CreateGodownPayload>;
    }) => updateGodown(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const isPending = createMut.isPending || updateMut.isPending;

  const handleSubmit = () => {
    setErr("");
    if (!form.GodownName?.trim()) {
      setErr("Godown name is required.");
      return;
    }
    if (editing) {
      updateMut.mutate({ id: editing.GodownID, payload: form });
    } else {
      createGodown(form)
        .then(() => {
          qc.invalidateQueries({ queryKey: ["godowns"] });
          onClose();
        })
        .catch((e: Error) => setErr(e.message));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-md bg-card border-l border-border flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Warehouse size={17} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-heading font-bold text-foreground">
                {editing ? "Edit Godown" : "New Godown"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {editing
                  ? `Editing ${editing.GodownName}`
                  : "Add a warehouse or storage location"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={15} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
              <AlertCircle size={13} /> {err}
            </div>
          )}

          <Field label="Godown Name" required>
            <input
              value={form.GodownName}
              onChange={(e) =>
                setForm((f) => ({ ...f, GodownName: e.target.value }))
              }
              placeholder="e.g. Site A Main Warehouse"
              className={inputCls}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Godown Code">
              <input
                value={form.GodownCode || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, GodownCode: e.target.value }))
                }
                placeholder="e.g. SITE-A"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field label="Short Label">
              <input
                value={form.ShortDesc || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ShortDesc: e.target.value }))
                }
                placeholder="Shown in badges"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={form.Description || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Description: e.target.value }))
              }
              rows={3}
              placeholder="What is stored here? Location details, purpose…"
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Remarks">
            <textarea
              value={form.Remarks || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Remarks: e.target.value }))
              }
              rows={2}
              placeholder="Any additional notes"
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-2 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !form.GodownName?.trim()}
            className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isPending ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            {editing ? "Save Changes" : "Create Godown"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────
function DeleteDialog({
  godown,
  onClose,
}: {
  godown: Godown | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: deleteGodown,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
  });

  if (!godown) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
          <Trash2 size={20} className="text-red-500" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-sm font-heading font-bold text-foreground">
            Delete Godown?
          </h2>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {godown.GodownName}
            </span>{" "}
            will be permanently removed. This cannot be undone.
          </p>
        </div>
        {mut.error && (
          <p className="text-xs text-red-600 text-center">
            {(mut.error as Error).message}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => mut.mutate(godown.GodownID)}
            disabled={mut.isPending}
            className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {mut.isPending ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Godown Card ──────────────────────────────────────────────────────────────
function GodownCard({
  godown,
  onEdit,
  onDelete,
}: {
  godown: Godown;
  onEdit: (g: Godown) => void;
  onDelete: (g: Godown) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group relative rounded-2xl border border-border bg-card hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200 overflow-hidden">
      {/* Top accent bar */}
      <div
        className={`h-1 w-full ${godown.IsMain ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-border to-border group-hover:from-emerald-500/40 group-hover:to-emerald-400/40 transition-all duration-300"}`}
      />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${godown.IsMain ? "bg-emerald-500/15" : "bg-muted"}`}
            >
              <Warehouse
                size={19}
                className={
                  godown.IsMain ? "text-emerald-600" : "text-muted-foreground"
                }
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-heading font-bold text-foreground truncate">
                  {godown.GodownName}
                </p>
                {godown.IsMain && (
                  <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-500/15 text-emerald-600 px-2 py-0.5 rounded-full font-bold tracking-wide uppercase shrink-0">
                    <Star size={8} fill="currentColor" /> Main
                  </span>
                )}
                {!godown.IsActive && (
                  <span className="text-[9px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                    Inactive
                  </span>
                )}
              </div>
              {godown.GodownCode && (
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                  {godown.GodownCode}
                </p>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical size={14} className="text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[140px]">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(godown);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-muted transition-colors text-foreground"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  {!godown.IsMain && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete(godown);
                      }}
                      className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 transition-colors text-red-500"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5">
          {godown.ShortDesc && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-[11px] text-muted-foreground">
              <Tag size={9} /> {godown.ShortDesc}
            </span>
          )}
          {godown.EnterpriseName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/10 text-[11px] text-blue-600">
              <Building2 size={9} /> {godown.EnterpriseName}
            </span>
          )}
          {godown.ProjectName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 text-[11px] text-violet-600">
              <Archive size={9} /> {godown.ProjectName}
            </span>
          )}
          {godown.Location && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/10 text-[11px] text-orange-600">
              <MapPin size={9} /> {godown.Location}
            </span>
          )}
        </div>

        {/* Description */}
        {godown.Description && (
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed line-clamp-2 border-t border-border pt-3">
            {godown.Description}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
          <Warehouse size={36} className="text-emerald-500/60" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500/20 border-2 border-card flex items-center justify-center">
          <Plus size={13} className="text-emerald-600" />
        </div>
      </div>
      <p className="text-base font-heading font-bold text-foreground mb-1">
        No godowns yet
      </p>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        Create your first warehouse or storage location to start tracking
        inventory across sites.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
      >
        <Plus size={14} /> Create First Godown
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InventoryMaster() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingGodown, setEditingGodown] = useState<Godown | null>(null);
  const [deletingGodown, setDeletingGodown] = useState<Godown | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 60_000,
  });

  const godowns: Godown[] = data?.data ?? [];

  const filtered = search.trim()
    ? godowns.filter(
        (g) =>
          g.GodownName.toLowerCase().includes(search.toLowerCase()) ||
          g.GodownCode?.toLowerCase().includes(search.toLowerCase()) ||
          g.ShortDesc?.toLowerCase().includes(search.toLowerCase()),
      )
    : godowns;

  // Sort: main first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    if (a.IsMain && !b.IsMain) return -1;
    if (!a.IsMain && b.IsMain) return 1;
    return a.GodownName.localeCompare(b.GodownName);
  });

  const handleEdit = (g: Godown) => {
    setEditingGodown(g);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingGodown(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setEditingGodown(null);
  };

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Material Module", "Inventory Master"]}
      />

      <GodownDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        editing={editingGodown}
      />
      <DeleteDialog
        godown={deletingGodown}
        onClose={() => setDeletingGodown(null)}
      />

      <div className="p-6 space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Warehouse size={17} className="text-emerald-600" />
              </div>
              Inventory Master
            </h1>
            <p className="text-xs text-muted-foreground mt-1 ml-[2.6rem]">
              Manage godowns and storage locations across all sites
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw
                size={14}
                className={`text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-500/20"
            >
              <Plus size={14} /> New Godown
            </button>
          </div>
        </div>

        {/* ── Stats strip ── */}
        {!isLoading && godowns.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-heading font-bold text-foreground">
                {godowns.length}
              </span>
              <span className="text-muted-foreground text-xs">
                Total Godowns
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="font-heading font-bold text-foreground">
                {godowns.filter((g) => g.IsActive).length}
              </span>
              <span className="text-muted-foreground text-xs">Active</span>
            </div>
            {godowns.some((g) => g.EnterpriseName) && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                <span className="font-heading font-bold text-foreground">
                  {
                    new Set(
                      godowns.map((g) => g.EnterpriseName).filter(Boolean),
                    ).size
                  }
                </span>
                <span className="text-muted-foreground text-xs">Companies</span>
              </div>
            )}
          </div>
        )}

        {/* ── Search ── */}
        {godowns.length > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-border bg-card w-full max-w-sm">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search godowns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X
                  size={13}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                />
              </button>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
            <AlertCircle size={15} />
            Failed to load godowns. Check your connection and try again.
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <div className="h-1 bg-muted animate-pulse" />
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-muted animate-pulse shrink-0" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-muted rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-6 w-16 bg-muted rounded-lg animate-pulse" />
                    <div className="h-6 w-20 bg-muted rounded-lg animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && godowns.length === 0 && <EmptyState onAdd={handleAdd} />}

        {/* ── Grid ── */}
        {!isLoading && sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((g) => (
              <GodownCard
                key={g.GodownID}
                godown={g}
                onEdit={handleEdit}
                onDelete={setDeletingGodown}
              />
            ))}
          </div>
        )}

        {/* ── No search results ── */}
        {!isLoading && godowns.length > 0 && sorted.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No godowns match{" "}
              <span className="font-semibold text-foreground">"{search}"</span>
            </p>
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </>
  );
}
