import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users,
  Hash,
  FileText,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Calendar,
} from "lucide-react";
import { getRoles, addRole, updateRole, deleteRole, type RoleRecord } from "@/api/roleApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

interface FormState {
  RName: string;
  RCode: string;
  RDesc: string;
}

const EMPTY: FormState = { RName: "", RCode: "", RDesc: "" };

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

function generateRoleCode(rName: string): string {
  if (!rName.trim()) return "";
  const words = rName.trim().split(/\s+/).filter(w => w);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
}

function buildColumns(
  editingId: number | null,
  deleteId: number | null,
  onEdit: (role: RoleRecord) => void,
  onDeleteRequest: (id: number) => void,
  onDeleteConfirm: (id: number) => void,
  onDeleteCancel: () => void,
): ColumnDef<RoleRecord, unknown>[] {
  return [
    {
      accessorKey: "RName",
      header: "Role Name",
      cell: ({ getValue }) => (
        <span className="font-heading font-medium text-foreground">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: "RCode",
      header: "Code",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded uppercase tracking-wider font-semibold text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "RDesc",
      header: "Description",
      cell: ({ getValue }) => (
        <span className="text-foreground/80 text-xs max-w-xs truncate block">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      accessorKey: "RCreatedAt",
      header: "Created",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {new Date(getValue() as string).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => {
        const role = row.original;
        const id = role.RId;
        return (
          <div className="flex items-center justify-end gap-1">
            {deleteId === id ? (
              <>
                <span className="text-[11px] text-muted-foreground mr-1">Confirm?</span>
                <button onClick={() => onDeleteConfirm(id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={13} /></button>
                <button onClick={onDeleteCancel} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={13} /></button>
              </>
            ) : (
              <>
                <button onClick={() => onEdit(role)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"><Edit2 size={13} /></button>
                <button onClick={() => onDeleteRequest(id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={13} /></button>
              </>
            )}
          </div>
        );
      },
    },
  ];
}

const RoleMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: dbData, isLoading, error } = useQuery({ queryKey: ["roles"], queryFn: getRoles, staleTime: 5 * 60 * 1000 });
  const dbRoles: RoleRecord[] = Array.isArray(dbData) ? dbData : [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const code = generateRoleCode(form.RName);
    setForm(prev => ({ ...prev, RCode: code }));
  }, [form.RName]);

  const setField = (k: keyof FormState, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: false }));
  };

  const validate = useCallback(() => {
    const e: Record<string, boolean> = {};
    if (!form.RName.trim()) e.RName = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [form.RName]);

  const handleSave = async () => {
    if (!validate()) return;
    try {
      const payload = { RName: form.RName.trim(), RDesc: form.RDesc.trim() || undefined };
      if (editingId) { await updateRole(editingId, payload); toast.success("Role updated!"); }
      else { await addRole(payload); toast.success("Role saved!"); }
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      setForm(EMPTY); setEditingId(null);
    } catch (err: any) { toast.error("Failed: " + err.message); }
  };

  const handleEdit = (item: RoleRecord) => {
    setForm({ RName: item.RName, RCode: item.RCode || "", RDesc: item.RDesc || "" });
    setEditingId(item.RId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRole(id); toast.success("Role deleted!");
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      setDeleteId(null);
      if (editingId === id) { setEditingId(null); setForm(EMPTY); }
    } catch (err: any) { toast.error("Delete failed: " + err.message); }
  };

  const columns = useMemo(
    () => buildColumns(editingId, deleteId, handleEdit, setDeleteId, handleDelete, () => setDeleteId(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteId],
  );

  if (error) return <div className="p-6 text-red-500">Failed to load roles.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Role Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Role Master</h1>

      <div className="space-y-5">
        {/* Form */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">{editingId ? "Edit Role" : "Add Role"}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{editingId ? "Modify role details below." : "Define a new user role."}</p>
            </div>
            {editingId && <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">Editing</span>}
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Role Name <span className="text-destructive">*</span></label>
                <div className="relative">
                  <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input type="text" value={form.RName} onChange={(e) => setField("RName", e.target.value)} placeholder="e.g. Branch Manager" className={`${inp} pl-8 ${errors.RName ? "border-destructive" : ""}`} />
                </div>
                {errors.RName && <p className="text-[11px] text-destructive mt-1">Role name is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Role Code</label>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={form.RCode} readOnly placeholder="Auto-generated" className={`${inp} pl-8 bg-muted/50 font-mono font-semibold tracking-wider text-primary`} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">{form.RName ? generateRoleCode(form.RName) : ""} (preview)</p>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Description</label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-3 text-muted-foreground pointer-events-none" />
                  <textarea rows={2} value={form.RDesc} onChange={(e) => setField("RDesc", e.target.value)} placeholder="Optional role description..." className={`${inp} pl-8 resize-none`} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
              <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all">
                <Users size={15} />{editingId ? "Update" : "Save Role"}
              </button>
              <button onClick={() => { setForm(EMPTY); setEditingId(null); setErrors({}); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all">
                <RotateCcw size={14} />Reset
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-card/60">
            <h3 className="font-heading font-semibold text-foreground text-sm">Role Records</h3>
          </div>
          <DataTable
            data={dbRoles}
            columns={columns}
            loading={isLoading}
            searchPlaceholder="Search roles..."
            emptyMessage="No roles yet. Add one above."
            rowClassName={(row) => editingId === row.original.RId ? "bg-primary/5 border-l-2 border-l-primary" : ""}
          />
        </div>
      </div>
    </>
  );
};

export default RoleMaster;
