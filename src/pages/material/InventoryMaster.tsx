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
  MoreVertical,
  Archive,
  Search,
  PackageOpen,
  TrendingUp,
  TrendingDown,
  Boxes,
  FolderKanban,
} from "lucide-react";
import {
  getGodowns,
  createGodown,
  updateGodown,
  deleteGodown,
  type Godown,
  type CreateGodownPayload,
} from "@/api/godownsApi";
import {
  getInventoryMaster,
  type InventoryMasterRow,
} from "@/api/inventoryMasterApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";

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
    Location: "",
    EnterpriseID: null,
    ProjectID: null,
  });
  const [err, setErr] = useState("");

  const { data: companiesData } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 300_000,
  });
  const companies = (companiesData ?? []) as { id: number; label: string }[];

  const { data: projectsData } = useQuery({
    queryKey: ["enterprise-options", "P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 300_000,
  });
  const allProjects = (projectsData ?? []) as {
    id: number;
    label: string;
    belongs_to: string | null;
  }[];
  const filteredProjects = form.EnterpriseID
    ? allProjects.filter(
        (p) => String(p.belongs_to) === String(form.EnterpriseID),
      )
    : allProjects;

  React.useEffect(() => {
    if (editing) {
      setForm({
        GodownName: editing.GodownName || "",
        GodownCode: editing.GodownCode || "",
        ShortDesc: editing.ShortDesc || "",
        Description: editing.Description || "",
        Remarks: editing.Remarks || "",
        Location: editing.Location || "",
        EnterpriseID: editing.EnterpriseID ?? null,
        ProjectID: editing.ProjectID ?? null,
      });
    } else {
      setForm({
        GodownName: "",
        GodownCode: "",
        ShortDesc: "",
        Description: "",
        Remarks: "",
        Location: "",
        EnterpriseID: null,
        ProjectID: null,
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
      createMut.mutate(form);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <select
                value={
                  form.EnterpriseID != null ? String(form.EnterpriseID) : ""
                }
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setForm((f) => ({ ...f, EnterpriseID: v, ProjectID: null }));
                }}
                className={inputCls}
              >
                <option value="">— None —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select
                value={form.ProjectID != null ? String(form.ProjectID) : ""}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setForm((f) => ({ ...f, ProjectID: v }));
                }}
                className={inputCls}
              >
                <option value="">— None —</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Location">
            <input
              type="text"
              value={form.Location || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Location: e.target.value }))
              }
              placeholder="Physical location of this godown"
              className={inputCls}
            />
          </Field>

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
        <div className="px-6 py-4 border-t border-border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <p className="hidden sm:block text-xs text-muted-foreground">
            {editing ? "Update godown details" : "Fill required fields to create"}
          </p>
          <div className="flex gap-2 sm:ml-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending || !form.GodownName?.trim()}
              className="flex-1 sm:flex-none whitespace-nowrap px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
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

  // Reset stale error state when the dialog opens for a new godown
  React.useEffect(() => {
    if (godown) mut.reset();
  }, [godown?.GodownID]);

  if (!godown) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
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

// ─── Godown Stock Panel (inline, below the card) ─────────────────────────────
function GodownStockPanel({
  godown,
  onClose,
}: {
  godown: Godown;
  onClose: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading, isError } = useQuery({
    queryKey: ["godown-stock", godown.GodownID],
    queryFn: () => getInventoryMaster(today, godown.GodownID),
    staleTime: 60_000,
  });

  const allItems: InventoryMasterRow[] = data?.data ?? [];
  const items = allItems
    .filter((r) => r.ClosingStock > 0)
    .sort((a, b) => b.ClosingStock - a.ClosingStock);
  const zeroItems = allItems.filter((r) => r.ClosingStock <= 0);
  const totalIn = allItems.reduce((s, r) => s + (r.StockIn ?? 0), 0);
  const totalOut = allItems.reduce((s, r) => s + (r.StockOut ?? 0), 0);

  return (
    <div className="col-span-full rounded-2xl border border-emerald-500/30 bg-card shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-emerald-500/5">
        <div className="flex items-center gap-2.5">
          <Warehouse size={15} className="text-emerald-600" />
          <span className="text-sm font-heading font-bold text-foreground">
            {godown.GodownName}
          </span>
          {godown.GodownCode && (
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {godown.GodownCode}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            — current stock
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <X size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* Summary strip */}
      {!isLoading && !isError && (
        <div className="px-5 py-2.5 border-b border-border flex gap-5 bg-muted/5">
          <div className="flex items-center gap-1.5">
            <Boxes size={12} className="text-emerald-500" />
            <span className="text-xs font-bold text-foreground">
              {items.length}
            </span>
            <span className="text-[11px] text-muted-foreground">in stock</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp size={12} className="text-emerald-500" />
            <span className="text-xs font-bold text-foreground">
              {totalIn.toLocaleString()}
            </span>
            <span className="text-[11px] text-muted-foreground">in</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingDown size={12} className="text-orange-500" />
            <span className="text-xs font-bold text-foreground">
              {totalOut.toLocaleString()}
            </span>
            <span className="text-[11px] text-muted-foreground">out</span>
          </div>
        </div>
      )}

      {/* Body */}
      {isLoading && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border animate-pulse"
            >
              <div className="w-7 h-7 rounded-lg bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 bg-muted rounded w-2/3" />
                <div className="h-2 bg-muted rounded w-1/4" />
              </div>
              <div className="h-5 w-12 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="m-5 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
          <AlertCircle size={13} /> Failed to load stock data.
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex items-center gap-3 py-8 justify-center text-center">
          <PackageOpen size={18} className="text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            No stock in this godown yet.
          </p>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.map((item) => {
            const utilPct =
              item.StockIn > 0
                ? Math.min(
                    100,
                    Math.round((item.ClosingStock / item.StockIn) * 100),
                  )
                : 0;
            return (
              <div
                key={item.ItemID}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:border-emerald-500/30 transition-all"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Archive size={12} className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {item.ItemName || item.ItemID}
                  </p>
                  {item.ItemGroupName && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {item.ItemGroupName}
                    </p>
                  )}
                  <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500/60"
                      style={{ width: `${utilPct}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold font-mono text-emerald-600">
                    {item.ClosingStock.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.UOMSymbol || item.UOMCode || ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && zeroItems.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-center pb-4">
          + {zeroItems.length} item{zeroItems.length > 1 ? "s" : ""} with zero
          stock not shown
        </p>
      )}
    </div>
  );
}

// ─── Godown Card ──────────────────────────────────────────────────────────────
function GodownCard({
  godown,
  onEdit,
  onDelete,
  onView,
  canEdit = true,
  canDelete = true,
}: {
  godown: Godown;
  onEdit: (g: Godown) => void;
  onDelete: (g: Godown) => void;
  onView: (g: Godown) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group relative rounded-2xl border border-border bg-card hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200 overflow-hidden cursor-pointer"
      onClick={(e) => {
        // Don't trigger when clicking the kebab menu
        if ((e.target as HTMLElement).closest("[data-menu]")) return;
        onView(godown);
      }}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500/40 to-emerald-400/40 group-hover:from-emerald-500 group-hover:to-emerald-400 transition-all duration-300" />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-muted">
              <Warehouse size={19} className="text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-heading font-bold text-foreground truncate">
                  {godown.GodownName}
                </p>
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
          <div className="relative shrink-0" data-menu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
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
                  {canEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEdit(godown);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-muted transition-colors text-foreground"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  )}
                  {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
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
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-[11px] text-emerald-600">
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
        Create your first project godown or storage location to start tracking
        inventory across sites. Seeded godowns are assigned per project.
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
  const rights = usePageRights("inventory-master");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingGodown, setEditingGodown] = useState<Godown | null>(null);
  const [deletingGodown, setDeletingGodown] = useState<Godown | null>(null);
  const [stockGodown, setStockGodown] = useState<Godown | null>(null);
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

  // Sort alphabetically
  const sorted = [...filtered].sort((a, b) => {
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

      <MaterialShell
        title="Inventory Master"
        subtitle="Manage godowns and stock locations"
        icon={Warehouse}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="p-2 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors"
              title="Refresh"
              style={{ color: "#34d399" }}
            >
              <RefreshCw
                size={14}
                className={isLoading ? "animate-spin" : ""}
              />
            </button>
            {rights.canCreate && (
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 text-sm font-semibold transition-colors"
              style={{ color: "#34d399" }}
            >
              <Plus size={14} /> New Godown
            </button>
            )}
          </div>
        }
      >
        {/* ── Stats strip ── */}
        {!isLoading && godowns.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-heading font-bold text-foreground">
                {godowns.length}
              </span>
              <span className="text-muted-foreground text-xs">
                Project Godowns
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
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
              <React.Fragment key={g.GodownID}>
                <GodownCard
                  godown={g}
                  onEdit={handleEdit}
                  onDelete={setDeletingGodown}
                  onView={(clicked) =>
                    setStockGodown((prev) =>
                      prev?.GodownID === clicked.GodownID ? null : clicked,
                    )
                  }
                  canEdit={rights.canEdit}
                  canDelete={rights.canDelete}
                />
                {stockGodown?.GodownID === g.GodownID && (
                  <GodownStockPanel
                    godown={g}
                    onClose={() => setStockGodown(null)}
                  />
                )}
              </React.Fragment>
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
              className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </MaterialShell>
    </>
  );
}