import React, { useState } from "react";
import { Search, Edit2, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "toggle" | "multiselect";
  required?: boolean;
  options?: string[];
  prefix?: string;
  uppercase?: boolean;
  fullWidth?: boolean;
  defaultValue?: string | boolean | string[];
}

export interface ColumnDef {
  key: string;
  label: string;
}

// FIX: Use a stable unique ID per record instead of array index.
//      Index-based IDs break when records are filtered/deleted — editing
//      filtered row 0 would overwrite actual row 0 in the unfiltered array.
type RecordWithId = Record<string, unknown> & { _id: string };

interface MasterPageProps {
  title: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  initialData: Record<string, unknown>[];
}

function getDefaults(f: FieldDef[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  f.forEach((field) => {
    if (field.type === "toggle") d[field.name] = field.defaultValue ?? true;
    else if (field.type === "multiselect") d[field.name] = field.defaultValue ?? [];
    else d[field.name] = field.defaultValue ?? "";
  });
  return d;
}

// Attach stable IDs to seed data
function seedWithIds(rows: Record<string, unknown>[]): RecordWithId[] {
  return rows.map((row, i) => ({ ...row, _id: `seed-${i}-${Date.now()}` }));
}

export const MasterPage: React.FC<MasterPageProps> = ({ title, fields, columns, initialData }) => {
  const [data, setData] = useState<RecordWithId[]>(() => seedWithIds(initialData));
  const [form, setForm] = useState<Record<string, unknown>>(() => getDefaults(fields));
  // FIX: editingId is now a stable string ID, not a fragile array index
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const updateField = (name: string, value: unknown, field: FieldDef) => {
    let v = value;
    if (field.uppercase && typeof v === "string") v = v.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const validate = () => {
    const errs: Record<string, boolean> = {};
    fields.forEach((f) => {
      if (f.required && (!form[f.name] || (typeof form[f.name] === "string" && !(form[f.name] as string).trim()))) errs[f.name] = true;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (editingId !== null) {
      // FIX: Match by stable _id, not by array position
      setData((prev) => prev.map((row) => row._id === editingId ? { ...form, _id: editingId } : row));
      setEditingId(null);
      toast.success("Record updated successfully ✓");
    } else {
      const newRecord: RecordWithId = { ...form, _id: `record-${Date.now()}` };
      setData((prev) => [...prev, newRecord]);
      toast.success("Record saved successfully ✓");
    }
    setForm(getDefaults(fields));
  };

  const handleEdit = (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    setForm({ ...row });
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    setData((prev) => prev.filter((r) => r._id !== id));
    setDeleteConfirmId(null);
    if (editingId === id) { setEditingId(null); setForm(getDefaults(fields)); }
    toast.success("Record deleted");
  };

  const handleReset = () => {
    setForm(getDefaults(fields));
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter((row) => {
    if (!search) return true;
    return Object.values(row).some((v) => String(v).toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <div>
      {/* Form */}
      <div className="rounded-xl bg-card border border-border p-4 sm:p-5 mb-5">
        <h2 className="font-heading font-semibold text-foreground text-lg mb-4">{editingId !== null ? `Edit ${title}` : `Add ${title}`}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((field) => {
            const isFullWidth = field.fullWidth || field.type === "textarea";
            return (
              <div key={field.name} className={isFullWidth ? "md:col-span-2" : ""}>
                <label className="block text-xs font-heading text-muted-foreground mb-1">
                  {field.label} {field.required && <span className="text-destructive">*</span>}
                </label>
                {field.type === "text" || field.type === "number" ? (
                  <div className="relative">
                    {field.prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{field.prefix}</span>}
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={(form[field.name] as string) || ""}
                      onChange={(e) => updateField(field.name, e.target.value, field)}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${field.prefix ? "pl-7" : ""} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                    />
                  </div>
                ) : field.type === "select" ? (
                  <select
                    value={(form[field.name] as string) || ""}
                    onChange={(e) => updateField(field.name, e.target.value, field)}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${errors[field.name] ? "border-destructive" : "border-border"}`}
                  >
                    <option value="">Select...</option>
                    {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    value={(form[field.name] as string) || ""}
                    onChange={(e) => updateField(field.name, e.target.value, field)}
                    rows={3}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${errors[field.name] ? "border-destructive" : "border-border"}`}
                  />
                ) : field.type === "toggle" ? (
                  <button
                    type="button"
                    onClick={() => updateField(field.name, !form[field.name], field)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form[field.name] ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform ${form[field.name] ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                ) : field.type === "multiselect" ? (
                  <div className="flex flex-wrap gap-2">
                    {field.options?.map((o) => {
                      const selected = ((form[field.name] as string[]) || []).includes(o);
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => {
                            const current = (form[field.name] as string[]) || [];
                            const next = selected ? current.filter((x: string) => x !== o) : [...current, o];
                            updateField(field.name, next, field);
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-heading border transition-all ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary"}`}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {errors[field.name] && <p className="text-xs text-destructive mt-1">{field.label} is required</p>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} className="px-5 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all">
            {editingId !== null ? "Update" : "Save"}
          </button>
          <button onClick={handleReset} className="px-5 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all">
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search records..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 text-left text-xs font-heading uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-wide text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {search ? "No records match your search." : "No records yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row._id} className="hover:bg-muted/30 transition-colors">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-foreground">
                        {col.key === "status" ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row[col.key] ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                            {row[col.key] ? "Active" : "Inactive"}
                          </span>
                        ) : (
                          String(row[col.key] ?? "")
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {deleteConfirmId === row._id ? (
                          <>
                            <button onClick={() => handleDelete(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors" title="Confirm delete">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setDeleteConfirmId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="Cancel">
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => handleEdit(row._id)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors" title="Edit">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => setDeleteConfirmId(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
