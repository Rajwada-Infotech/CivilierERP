import { useState, useMemo, useEffect } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
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
import { BodyPortal } from "@/components/ui/body-portal";

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
  "w-full px-3 py-2 text-sm font-body bg-card border border-foreground/40 focus:border-foreground outline-none text-foreground placeholder:text-muted-foreground/60";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors";

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
        <span className="font-heading text-xs font-semibold tracking-wider text-foreground border border-foreground/30 px-1.5 py-0.5">
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
              <span className="text-[0.6875rem] text-destructive mr-1">
                Delete?
              </span>
              <button
                onClick={() => handleDelete(id)}
                className={`${ACT} text-destructive border-destructive hover:bg-destructive/10`}
                title="Confirm delete"
                aria-label="Confirm delete"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                title="Keep"
                aria-label="Keep"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <button data-row-view
              onClick={() => onView(row.original)}
              className={`${ACT} hover:text-foreground hover:border-foreground`}
              title="View details"
              aria-label="View details"
            >
              <Eye size={13} />
            </button>
            {canEdit && (
              <button
                onClick={() => handleEdit(row.original)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                title="Edit"
                aria-label="Edit"
              >
                <Edit2 size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteId(id)}
                className={`${ACT} hover:text-destructive hover:border-destructive`}
                title="Delete"
                aria-label="Delete"
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
      if (editingId != null) {
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
    return <div className="p-6 text-sm text-muted-foreground">Loading roles…</div>;
  if (error)
    return <div className="p-6 text-sm text-destructive">Could not load the roles.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Role Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Setup"
        title="Roles"
        subtitle="The user roles that page rights, menu rights and approvals are granted to."
      >
      <div className="space-y-5">
        {/* ── Form ── (also shown to editors without create rights once they pick a role to edit) */}
        {(rights.canCreate || editingId != null) && (
        <div className={`bg-card overflow-hidden border border-foreground`}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: RULE }}>
            <div>
              <h2 className={HEAD}>
                {editingId ? "Edit role" : "Add role"}
              </h2>
              <p className="text-[0.6875rem] text-muted-foreground mt-1">
                {editingId
                  ? "Modify role details below."
                  : "Define a new user role."}
              </p>
            </div>
            {editingId && (
              <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-dashed border-foreground text-foreground">
                Editing
              </span>
            )}
          </div>

          <div className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Role Name */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
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
                  <p className="text-[0.6875rem] text-destructive mt-1">
                    Role name is required
                  </p>
                )}
              </div>

              {/* Role Code (Read-only preview) */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
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
                    className={`${inp} pl-8 border-dashed font-heading font-semibold tracking-wider`}
                    title="Auto-generated from Role Name (server authoritative)"
                  />
                </div>
                <p className="text-[0.625rem] text-muted-foreground mt-1 font-heading tracking-wide">
                  {form.RName ? generateRoleCode(form.RName) : ""} (preview)
                </p>
              </div>

              {/* Description */}
              <div className="lg:col-span-2">
                <label className={`${LBL} block mb-1.5`}>
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

            <div className="flex items-center gap-2 mt-5 pt-4 -mx-4 px-4" style={{ borderTop: RULE }}>
              <button onClick={handleSave} className={`${KEY_INK} h-9 px-5`}>
                <Users size={13} />
                {editingId ? "Update" : "Save role"}
              </button>
              <button onClick={handleReset} className={`${KEY_LINE} h-9 px-4`}>
                <RotateCcw size={12} />
                {editingId ? "Cancel edit" : "Reset"}
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ── Table ── */}
        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <div>
              <h3 className={HEAD}>
                Roles <span className="font-normal text-muted-foreground tabular-nums ml-1">{filtered.length}</span>
              </h3>
              <p className="text-[0.6875rem] text-muted-foreground mt-1">
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
                aria-label="Search roles"
                className="h-9 pl-8 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 outline-none w-full sm:w-56"
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
                  ? "bg-primary/5 border-l-2 border-l-foreground"
                  : ""
              }
            />
          </div>
        </div>
      </div>
      </SheetShell>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200" style={{ borderLeft: RULE }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: RULE }}>
              <div>
                <p className={LBL}>Role</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-0.5">
                  {viewRecord.RName}
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                aria-label="Close"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <p className={`${LBL} mb-1`}>
                  Role Name
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.RName}
                </p>
              </div>
              <div>
                <p className={`${LBL} mb-1`}>
                  Role Code
                </p>
                <p className="font-heading text-sm font-semibold tracking-wider text-foreground">
                  {viewRecord.RCode || "—"}
                </p>
              </div>
              <div>
                <p className={`${LBL} mb-1`}>
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
            {rights.canEdit && (
            <div className="px-5 py-3" style={{ borderTop: RULE }}>
              <button
                onClick={() => {
                  handleEdit(viewRecord);
                  setViewRecord(null);
                }}
                className={`${KEY_INK} w-full h-9 px-4`}
              >
                <Edit2 size={12} /> Edit role
              </button>
            </div>
            )}
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default RoleMaster;
