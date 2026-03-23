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

interface MasterPageProps {
  title: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  initialData: Record<string, any>[];
}

export const MasterPage: React.FC<MasterPageProps> = ({ title, fields, columns, initialData }) => {
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState<Record<string, any>>(() => getDefaults(fields));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  function getDefaults(f: FieldDef[]): Record<string, any> {
    const d: Record<string, any> = {};
    f.forEach((field) => {
      if (field.type === "toggle") d[field.name] = field.defaultValue ?? true;
      else if (field.type === "multiselect") d[field.name] = field.defaultValue ?? [];
      else d[field.name] = field.defaultValue ?? "";
    });
    return d;
  }

  const updateField = (name: string, value: any, field: FieldDef) => {
    let v = value;
    if (field.uppercase && typeof v === "string") v = v.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const validate = () => {
    const errs: Record<string, boolean> = {};
    fields.forEach((f) => {
      if (f.required && (!form[f.name] || (typeof form[f.name] === "string" && !form[f.name].trim()))) errs[f.name] = true;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (editingId !== null) {
      setData((prev) => prev.map((row, i) => (i === editingId ? { ...form } : row)));
      setEditingId(null);
      toast.success("Record updated successfully ✓");
    } else {
      setData((prev) => [...prev, { ...form }]);
      toast.success("Record saved successfully ✓");
    }
    setForm(getDefaults(fields));
  };

  const handleEdit = (index: number) => {
    setForm({ ...data[index] });
    setEditingId(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (index: number) => {
    setData((prev) => prev.filter((_, i) => i !== index));
    setDeleteConfirm(null);
    if (editingId === index) { setEditingId(null); setForm(getDefaults(fields)); }
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
                      value={form[field.name] || ""}
                      onChange={(e) => updateField(field.name, e.target.value, field)}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${field.prefix ? "pl-7" : ""} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                    />
                  </div>
                ) : field.type === "select" ? (
                  <select
                    value={form[field.name] || ""}
                    onChange={(e) => updateField(field.name, e.target.value, field)}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${errors[field.name] ? "border-destructive" : "border-border"}`}
                  >
                    <option value="">Select...</option>
                    {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    value={form[field.name] || ""}
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
                      const selected = (form[field.name] as string[] || []).includes(o);
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => {
                            const current = form[field.name] as string[] || [];
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
                <th className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">#</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">{col.label}</th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className={`border-b border-border transition-colors hover:bg-muted/50 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                  <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-foreground">
                      {col.key === "status" ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row[col.key] ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {row[col.key] ? "Active" : "Inactive"}
                        </span>
                      ) : Array.isArray(row[col.key]) ? (
                        (row[col.key] as string[]).join(", ")
                      ) : (
                        String(row[col.key] ?? "")
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {deleteConfirm === i ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Sure?</span>
                        <button onClick={() => handleDelete(i)} className="text-destructive hover:bg-destructive/10 p-1 rounded"><Check size={14} /></button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-muted-foreground hover:bg-muted p-1 rounded"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEdit(i)} className="p-1.5 rounded hover:bg-muted transition-colors text-primary"><Edit2 size={14} /></button>
                        <button onClick={() => setDeleteConfirm(i)} className="p-1.5 rounded hover:bg-muted transition-colors text-destructive"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length + 2} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
