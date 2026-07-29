import { useState, useMemo, useEffect } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  Users,
  Hash,
  FileText,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Search,
  Eye,
  XCircle,
  Shield,
} from "lucide-react";
import {
  getRoles,
  addRole,
  updateRole,
  deleteRole,
  type RoleRecord,
} from "@/api/roleApi";
import {
  roleMasterSchema,
  type RoleMasterForm,
} from "@/schemas/roleMasterSchema";

// ─── Local form types ────────────────────────────────────────────────────────
interface FormState {
  RName: string;
  RCode: string;
  RDesc: string;
}

const EMPTY: FormState = {
  RName: "",
  RCode: "",
  RDesc: "",
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

// ─── Column builder ───────────────────────────────────────────────────────────
function buildRoleColumns(
  _editingId: number | null,
  deleteId: number | null,
  setDeleteId: (id: number | null) => void,
  handleEdit: (item: RoleRecord) => void,
  handleDelete: (id: number) => void,
  onView: (item: RoleRecord) => void,
  canEdit: boolean,
  canDelete: boolean,
): ColumnDef<RoleRecord, unknown>[] {
  return [
    {
      accessorKey: "RCode",
      header: "Code",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "RName",
      header: "Role Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "RDesc",
      header: "Description",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.RId;
        if (deleteId === id) {
          return (
            <div className="flex items-center gap-1 justify-end">
              <span className="text-[11px] text-muted-foreground mr-1">
                Delete?
              </span>
              <button
                onClick={() => handleDelete(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className="p-1 rounded text-muted-foreground hover:bg-muted"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onView(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10"
              title="View details"
            >
              <Eye size={13} />
            </button>
            {canEdit && (
              <button
                onClick={() => handleEdit(row.original)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <Edit2 size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteId(id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

// Client-side code generator (preview only)
function generateRoleCode(rName: string): string {
  if (!rName.trim()) return "";
  const words = rName
    .trim()
    .split(/\s+/)
    .filter((w) => w);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

// ─── Component ───────────────────────────────────────────────────────────────
const RoleMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("roles");

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["roles"],
    queryFn: getRoles,
    staleTime: 5 * 60 * 1000,
  });

  const dbRoles: RoleRecord[] = Array.isArray(dbData) ? dbData : [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const {
    reset,
    setValue,
    trigger,
    clearErrors,
    formState: { errors },
  } = useForm<RoleMasterForm>({
    resolver: zodResolver(roleMasterSchema),
    defaultValues: EMPTY,
  });
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<RoleRecord | null>(null);

  // Auto-generate RCode on RName change (preview)
  useEffect(() => {
    const code = generateRoleCode(form.RName);
    setForm((prev) => ({ ...prev, RCode: code }));
  }, [form.RName]);

  const setField = (k: keyof FormState, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (k === "RName" || k === "RDesc") {
      setValue(k, v, { shouldValidate: !!errors[k] });
    }
  };

  const validate = async () => {
    reset({ RName: form.RName, RDesc: form.RDesc });
    return trigger();
  };

  const toPayload = () => ({
    RName: form.RName.trim(),
    RDesc: form.RDesc.trim() || undefined,
  });

  const handleEdit = (item: RoleRecord) => {
    const nextForm = {
      RName: item.RName,
      RCode: item.RCode || "",
      RDesc: item.RDesc || "",
    };
    setForm(nextForm);
    reset({ RName: nextForm.RName, RDesc: nextForm.RDesc });
    setEditingId(item.RId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRole(id);
      toast.success("Role deleted!");
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      setDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY);
        reset(EMPTY);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const columns = useMemo(
    () =>
      buildRoleColumns(
        editingId,
        deleteId,
        setDeleteId,
        handleEdit,
        handleDelete,
        setViewRecord,
        rights.canEdit,
        rights.canDelete,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteId, rights.canEdit, rights.canDelete],
  );

  const handleSave = async () => {
    if (!(await validate())) return;

    try {
      if (editingId) {
        await updateRole(editingId, toPayload());
        toast.success("Role updated!");
      } else {
        await addRole(toPayload());
        toast.success("Role saved!");
      }
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      setForm(EMPTY);
      reset(EMPTY);
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    reset(EMPTY);
    clearErrors();
  };

  const filtered = dbRoles.filter((role) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      role.RName.toLowerCase().includes(q) ||
      (role.RCode || "").toLowerCase().includes(q) ||
      (role.RDesc || "").toLowerCase().includes(q)
    );
  });

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading roles...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load roles.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Role Master"]} />
      <AdminShell title="Role Master" icon={Shield}>
      <div className="space-y-5">
        {/* ── Form ── */}
        {rights.canCreate && (
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Role" : "Add Role"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId
                  ? "Modify role details below."
                  : "Define a new user role."}
              </p>
            </div>
            {editingId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">
                Editing
              </span>
            )}
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Role Name */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Role Name <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Users
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="text"
                    value={form.RName}
                    onChange={(e) => setField("RName", e.target.value)}
                    placeholder="e.g. Branch Manager"
                    className={`${inp} pl-8 ${errors.RName ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.RName && (
                  <p className="text-[11px] text-destructive mt-1">
                    Role name is required
                  </p>
                )}
              </div>

              {/* Role Code (Read-only preview) */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Role Code
                </label>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={form.RCode}
                    readOnly
                    placeholder="Auto-generated"
                    className={`${inp} pl-8 bg-muted/50 font-mono font-semibold tracking-wider text-primary`}
                    title="Auto-generated from Role Name (server authoritative)"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  {form.RName ? generateRoleCode(form.RName) : ""} (preview)
                </p>
              </div>

              {/* Description */}
              <div className="lg:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Description
                </label>
                <div className="relative">
                  <FileText
                    size={14}
                    className="absolute left-3 top-3 text-muted-foreground pointer-events-none"
                  />
                  <textarea
                    rows={2}
                    value={form.RDesc}
                    onChange={(e) => setField("RDesc", e.target.value)}
                    placeholder="Optional role description..."
                    className={`${inp} pl-8 resize-none`}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold text-white shadow-sm bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 transition-all"
              >
                <Users size={15} />
                {editingId ? "Update" : "Save Role"}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ── Table ── */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                Role Records ({filtered.length})
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Manage user roles for access control
              </p>
            </div>
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search roles..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary w-44"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <DataTable
              data={filtered}
              columns={columns}
              searchable={false}
              paginated={true}
              defaultPageSize={25}
              emptyMessage={
                search
                  ? "No roles match your search."
                  : "No roles yet. Add one above."
              }
              rowClassName={(row) =>
                row.original.RId === editingId
                  ? "bg-primary/5 border-l-2 border-l-primary"
                  : ""
              }
            />
          </div>
        </div>
      </div>
      </AdminShell>

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
                <Users size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Role Details
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
                  Role Name
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.RName}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Role Code
                </p>
                <p className="font-mono text-sm font-semibold text-primary">
                  {viewRecord.RCode || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Description
                </p>
                <p className="text-sm text-foreground">
                  {viewRecord.RDesc || (
                    <span className="text-muted-foreground italic">
                      No description
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => {
                  handleEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Edit2 size={13} /> Edit Role
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RoleMaster;
