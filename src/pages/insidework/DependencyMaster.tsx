import React, { useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InsideWorkShell } from "@/components/insidework/InsideWorkShell";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  Eye,
  GitBranch,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDependencies,
  addDependency,
  updateDependency,
  deleteDependency,
  type Dependency as DbDependency,
} from "@/api/dependencyApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Dependency {
  _id: string;
  code: string;
  name: string;
  isActive: boolean;
}

function dbToDependency(row: DbDependency): Dependency {
  return {
    _id: String(row.id),
    code: row.code || "",
    name: row.name || "",
    isActive: row.isActive,
  };
}

function dependencyToPayload(form: Omit<Dependency, "_id">) {
  return {
    code: form.code,
    name: form.name,
    isActive: form.isActive,
  };
}

const EMPTY_FORM: Omit<Dependency, "_id"> = {
  code: "",
  name: "",
  isActive: true,
};

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: boolean;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wide">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && (
      <span className="text-xs text-destructive">{label} is required</span>
    )}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;

// ── Main Component ────────────────────────────────────────────────────────────
const DependencyMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("dependency-master");

  // ── Query ──────────────────────────────────────────────────────────────────
  const {
    data: dbDependencies = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
    staleTime: 5 * 60 * 1000,
  });

  const data: Dependency[] = (
    Array.isArray(dbDependencies) ? dbDependencies : []
  ).map(dbToDependency);

  // ── Local state ───────────────────────────────────────────────────────────
  const [form, setFormState] = useState<Omit<Dependency, "_id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewRow, setViewRow] = useState<Dependency | null>(null);

  const set = useCallback(
    (key: keyof Omit<Dependency, "_id">, val: unknown) => {
      setFormState((p) => ({ ...p, [key]: val }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.code.trim()) errs.code = true;
    if (!form.name.trim()) errs.name = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateDependency(Number(editingId), dependencyToPayload(form));
        toast.success("Dependency updated successfully ✓");
        setEditingId(null);
      } else {
        await addDependency(dependencyToPayload(form));
        toast.success("Dependency saved successfully ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["dependencies"] });
      setFormState(EMPTY_FORM);
      setErrors({});
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    const { _id, ...rest } = row;
    setFormState(rest);
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setFormState(EMPTY_FORM);
    }
    try {
      await deleteDependency(Number(id));
      toast.success("Dependency deactivated");
      await queryClient.invalidateQueries({ queryKey: ["dependencies"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setDeleteConfirmId(null);
  };

  const handleReset = () => {
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter(
    (r) =>
      !search ||
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(search.toLowerCase()),
      ),
  );

  // ── Column Definitions ────────────────────────────────────────────────────
  const DEPENDENCY_COLUMNS: ColumnDef<Dependency>[] = [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono font-medium text-primary">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            Inactive
          </span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const id = row.original._id;
        const isConfirming = deleteConfirmId === id;

        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              // Inline delete confirmation
              <>
                <span className="text-xs text-destructive mr-1">Delete?</span>
                <button
                  title="Confirm delete"
                  onClick={() => handleDelete(id)}
                  className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                >
                  <Check size={15} />
                </button>
                <button
                  title="Cancel"
                  onClick={() => setDeleteConfirmId(null)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  title="View details"
                  onClick={() => setViewRow(row.original)}
                  className="p-1 rounded hover:bg-sky-500/10 text-sky-500 transition-colors"
                >
                  <Eye size={15} />
                </button>
                {rights.canEdit && (
                  <button
                    title="Edit"
                    onClick={() => handleEdit(id)}
                    className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
                  >
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button
                    title="Delete"
                    onClick={() => setDeleteConfirmId(id)}
                    className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading dependencies...
      </div>
    );
  if (error)
    return (
      <div className="p-8 text-destructive">
        Failed to load dependencies. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Inside Work", "Setup", "Dependency"]} />
      <InsideWorkShell
        title="Dependency"
        subtitle="Manage your dependency master"
        icon={GitBranch}
      >
        {/* ── Form ── */}
        {rights.canCreate && (
          <div className="rounded-xl border border-border bg-card p-6 mb-6">
            <h2 className="text-base font-heading font-semibold mb-4">
              {editingId ? "Edit Dependency" : "Add Dependency"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Code */}
              <Field label="Code" required error={errors.code}>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  className={inputCls(errors.code)}
                  placeholder="e.g. ELEC"
                  maxLength={50}
                />
              </Field>
              {/* Name */}
              <Field label="Name" required error={errors.name}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className={inputCls(errors.name)}
                  placeholder="e.g. Electrical Clearance"
                />
              </Field>
              {/* Active toggle */}
              <Field label="Status">
                <select
                  value={form.isActive ? "active" : "inactive"}
                  onChange={(e) => set("isActive", e.target.value === "active")}
                  className={inputCls()}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-5 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {editingId
                  ? "Editing an existing dependency."
                  : "Fill in the fields above and click Save to add a new dependency."}
              </p>
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  onClick={handleReset}
                  className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={12} /> Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                >
                  {saving ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : editingId ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {saving ? "Saving…" : editingId ? "Update" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="relative mb-4">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search dependencies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <DataTable
            data={filtered}
            columns={DEPENDENCY_COLUMNS}
            loading={false}
            searchable={false}
            paginated={true}
            defaultPageSize={20}
            emptyMessage={
              search
                ? "No dependencies match your search."
                : "No dependencies yet. Add one above."
            }
            rowClassName={(row) =>
              row.original._id === deleteConfirmId ? "bg-destructive/5" : ""
            }
          />
        </div>

        {/* View Detail Modal */}
        <Dialog
          open={!!viewRow}
          onOpenChange={(open) => !open && setViewRow(null)}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Dependency Details
              </DialogTitle>
            </DialogHeader>
            {viewRow && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
                {[
                  { label: "Code", value: viewRow.code, mono: true },
                  { label: "Name", value: viewRow.name },
                  {
                    label: "Status",
                    value: viewRow.isActive ? "Active" : "Inactive",
                  },
                ].map(({ label, value, mono }) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-0.5">
                      {label}
                    </p>
                    <p
                      className={`text-sm text-foreground break-words ${mono ? "font-mono" : "font-body"}`}
                    >
                      {value || "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
              <button
                onClick={() => setViewRow(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </InsideWorkShell>
    </>
  );
};

export default DependencyMaster;
