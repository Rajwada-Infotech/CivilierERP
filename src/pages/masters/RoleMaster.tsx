import React, { useState, useEffect, useCallback } from "react";
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
  Search,
  Calendar,
} from "lucide-react";
import { getRoles, addRole, updateRole, deleteRole, type RoleRecord } from "@/api/roleApi";

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

// Client-side code generator (preview only)
function generateRoleCode(rName: string): string {
  if (!rName.trim()) return "";
  const words = rName.trim().split(/\s+/).filter(w => w);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
}

// ─── Component ───────────────────────────────────────────────────────────────
const RoleMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["roles"],
    queryFn: getRoles,
  });

  const dbRoles: RoleRecord[] = Array.isArray(dbData) ? dbData : [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Auto-generate RCode on RName change (preview)
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

  const toPayload = () => ({
    RName: form.RName.trim(),
    RDesc: form.RDesc.trim() || undefined,
  });

  const handleSave = async () => {
    if (!validate()) return;

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
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleEdit = (item: RoleRecord) => {
    setForm({
      RName: item.RName,
      RCode: item.RCode || "",
      RDesc: item.RDesc || "",
    });
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
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading roles...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load roles.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Role Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Role Master
      </h1>

      <div className="space-y-5">
        {/* ── Form ── */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Role" : "Add Role"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId ? "Modify role details below." : "Define a new user role."}
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
                  <p className="text-[11px] text-destructive mt-1">Role name is required</p>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Role Name", "Code", "Description", "Created", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-muted-foreground text-sm"
                    >
                      {search ? "No roles match your search." : "No roles yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((role) => {
                    const id = role.RId;
                    return (
                      <tr
                        key={id}
                        className={`hover:bg-muted/20 transition-colors ${
                          editingId === id ? "bg-primary/5 border-l-2 border-l-primary" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-heading font-medium text-foreground">
                          {role.RName}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded uppercase tracking-wider font-semibold text-primary">
                            {role.RCode || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground/80 text-xs max-w-xs truncate">
                          {role.RDesc || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {new Date(role.RCreatedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {deleteId === id ? (
                              <>
                                <span className="text-[11px] text-muted-foreground mr-1">Confirm?</span>
                                <button
                                  onClick={() => handleDelete(id)}
                                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  onClick={() => setDeleteId(null)}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                                >
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(role)}
                                  className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={() => setDeleteId(id)}
                                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default RoleMaster;
