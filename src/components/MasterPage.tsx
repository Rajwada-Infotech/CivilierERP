import React from "react";
import { useState } from "react";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Plus,
  RotateCcw,
  Eye,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface FieldDef {
  name: string;
  label: string;
  type:
    | "text"
    | "number"
    | "date"
    | "select"
    | "textarea"
    | "toggle"
    | "multiselect"
    | "custom";
  required?: boolean;
  options?: string[];
  optionsProvider?: (
    data: RecordWithId[],
    currentId?: string,
  ) => { value: string; label: string }[];
  asyncOptions?: () => Promise<{ value: string; label: string }[]>;
  prefix?: string;
  uppercase?: boolean;
  fullWidth?: boolean;
  defaultValue?: string | boolean | string[];
  placeholder?: string;
  mode?: string;
  render?: (props: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
    formData: Record<string, unknown>;
  }) => React.ReactNode;
}

export interface ColumnDef {
  key: string;
  label: string;
  hideOnMobile?: boolean;
}

export type RecordWithId = Record<string, unknown> & { _id: string };

export type DataChangeEvent =
  | {
      action: "add";
      record: Record<string, unknown>;
      records: Record<string, unknown>[];
    }
  | {
      action: "update";
      id: string;
      record: Record<string, unknown>;
      records: Record<string, unknown>[];
    }
  | { action: "delete"; id: string; records: Record<string, unknown>[] };

interface MasterPageProps {
  title: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  columnRenderers?: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  >;
  defaultRenderers?: boolean;
  contextData?: Record<string, unknown>;
  loading?: boolean;
  initialData: Record<string, unknown>[];
  onDataChange?: (records: Record<string, unknown>[]) => void;
  onDataEvent?: (
    event: DataChangeEvent,
  ) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>;
  onFormChange?: (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
    allRecords: Record<string, unknown>[],
  ) => void;
  onFieldChange?: (
    form: Record<string, unknown>,
    fieldName: string,
  ) => Record<string, unknown>;
  onCustomSave?: (
    formData: Record<string, unknown>,
    isEdit: boolean,
    allRecords: Record<string, unknown>[],
  ) => Record<string, unknown> | null;
  externalFormPatch?: Record<string, unknown> | null;
  externalFormPatchKey?: string | number | null;
  /**
   * When provided, an Export button appears in the table toolbar.
   * Pass ExportColumn[] — plain { header, accessor } descriptors.
   *
   * @example
   * exportConfig={{
   *   title: "Purchase Order",
   *   filename: "purchase-orders",
   *   columns: [
   *     { header: "PO No", accessor: "poNumber" },
   *     { header: "Supplier", accessor: "supplierName" },
   *   ],
   * }}
   */
  exportConfig?: {
    title: string;
    filename?: string;
    subtitle?: string;
    columns: ExportColumn[];
  };
  /** When true, hides the records table and shows only the form card */
  hideTable?: boolean;
  /**
   * When provided, an Eye button appears per row to show a read-only detail
   * modal. Pass the field keys + labels you want displayed.
   */
  viewConfig?: {
    title: string;
    fields: { key: string; label: string; mono?: boolean }[];
  };
  /**
   * When provided, a Print button appears per row. Called with the row record
   * so the page can open a print layout or window.print().
   */
  onPrint?: (row: RecordWithId) => void;
}

function getDefaults(f: FieldDef[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  f.forEach((field) => {
    if (field.type === "toggle") d[field.name] = field.defaultValue ?? true;
    else if (field.type === "multiselect")
      d[field.name] = field.defaultValue ?? [];
    else d[field.name] = field.defaultValue ?? "";
  });
  return d;
}

function seedWithIds(rows: Record<string, unknown>[]): RecordWithId[] {
  return rows.map((row) => ({
    ...row,
    _id: (row._id as string) || `seed-${Math.random().toString(36).slice(2)}`,
  }));
}

export const MasterPage: React.FC<MasterPageProps> = ({
  title,
  fields,
  columns,
  columnRenderers,
  initialData,
  onDataChange,
  onDataEvent,
  onFormChange,
  onFieldChange,
  onCustomSave,
  externalFormPatch,
  externalFormPatchKey,
  exportConfig,
  hideTable,
  viewConfig,
  onPrint,
}) => {
  const [data, setData] = useState<RecordWithId[]>(() =>
    seedWithIds(initialData),
  );
  const [form, setForm] = useState<Record<string, unknown>>(() =>
    getDefaults(fields),
  );
  const [viewRow, setViewRow] = useState<RecordWithId | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // keep internal data in sync when initialData changes (e.g. after DB refetch)
  const prevInitialRef = React.useRef<Record<string, unknown>[]>([]);
  React.useEffect(() => {
    const prev = prevInitialRef.current;
    // Guard: never replace existing rows with a transient empty array that
    // arrives while invalidateQueries is mid-flight. Without this the list
    // blanks out briefly every time a record is unlocked or updated.
    if (initialData.length === 0 && prev.length > 0) return;
    const same =
      prev.length === initialData.length &&
      initialData.every(
        (row, i) => JSON.stringify(row) === JSON.stringify(prev[i]),
      );
    if (!same) {
      prevInitialRef.current = initialData;
      setData(seedWithIds(initialData));
    }
  }, [initialData]);

  const prevPatchKeyRef = React.useRef<string | number | null>(null);
  React.useEffect(() => {
    if (externalFormPatchKey === null || externalFormPatchKey === undefined)
      return;
    if (prevPatchKeyRef.current === externalFormPatchKey) return;
    prevPatchKeyRef.current = externalFormPatchKey;
    setForm((current) => ({ ...current, ...(externalFormPatch ?? {}) }));
    setErrors({});
  }, [externalFormPatch, externalFormPatchKey]);

  const applyPatch = (
    next: Record<string, unknown>,
    currentData: RecordWithId[],
  ) => {
    if (onFormChange) {
      onFormChange(
        next,
        (patch) => {
          setForm((current) => ({ ...current, ...patch }));
        },
        currentData,
      );
    }
  };

  const updateField = (name: string, value: unknown, field: FieldDef) => {
    let v = value;
    if (field.uppercase && typeof v === "string") v = v.toUpperCase();
    setForm((prev) => {
      const next = onFieldChange
        ? onFieldChange({ ...prev, [name]: v }, name)
        : { ...prev, [name]: v };
      applyPatch(next, data);
      return next;
    });
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const updateCustomField = (name: string, value: unknown) => {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      applyPatch(next, data);
      return next;
    });
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const validate = () => {
    const errs: Record<string, boolean> = {};
    fields.forEach((f) => {
      if (
        f.required &&
        (!form[f.name] ||
          (typeof form[f.name] === "string" &&
            !(form[f.name] as string).trim()))
      )
        errs[f.name] = true;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    const finalData: Record<string, unknown> = onCustomSave
      ? (onCustomSave(form, editingId !== null, data) ?? {})
      : { ...form };

    if (onCustomSave && Object.keys(finalData).length === 0) return;

    try {
      if (editingId !== null) {
        const next = data.map((row) =>
          row._id === editingId ? { ...finalData, _id: editingId } : row,
        );
        const stripped = next.map(({ _id, ...rest }) => rest);
        setData(next);
        onDataChange?.(stripped);
        await onDataEvent?.({
          action: "update",
          id: editingId,
          record: finalData,
          records: stripped,
        });
        setEditingId(null);
        toast.success("Record updated successfully ✓");
        setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
      } else {
        const newId = `record-${Date.now()}`;
        const newRecord: RecordWithId = { ...finalData, _id: newId };
        const next = [...data, newRecord];
        const stripped = next.map(({ _id, ...rest }) => rest);
        setData(next);
        onDataChange?.(stripped);
        const result = await onDataEvent?.({
          action: "add",
          record: finalData,
          records: stripped,
        });
        toast.success("Record saved successfully ✓");
        setForm({
          ...getDefaults(fields),
          ...(externalFormPatch ?? {}),
          ...(result && typeof result === "object" && !Array.isArray(result)
            ? result
            : {}),
        });
        return;
      }
    } catch {
      // Page-level handlers already raise the most useful toast message.
    }
  };

  const handleEdit = (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    setForm({ ...row });
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    setData((prev) => {
      const next = prev.filter((r) => r._id !== id);
      const stripped = next.map(({ _id, ...rest }) => rest);
      onDataChange?.(stripped);
      onDataEvent?.({ action: "delete", id, records: stripped });
      return next;
    });
    setDeleteConfirmId(null);
    if (editingId === id) {
      setEditingId(null);
      setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
    }
    toast.success("Record deleted");
  };

  const handleReset = () => {
    setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter((row) => {
    if (!search) return true;
    return Object.values(row).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase()),
    );
  });

  const inputBase =
    "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";

  return (
    <div className="space-y-5">
      {/* ── FORM CARD ── */}
      <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-visible">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60 rounded-t-xl">
          <div>
            <h2 className="font-heading font-semibold text-foreground text-sm">
              {editingId !== null ? `Edit ${title}` : `Add ${title}`}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {editingId !== null
                ? "Modify the details below and save."
                : "Fill in the details to create a new record."}
            </p>
          </div>
          {editingId !== null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">
              Editing
            </span>
          )}
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => {
              const isFullWidth = field.fullWidth || field.type === "textarea";
              return (
                <div
                  key={field.name}
                  className={isFullWidth ? "md:col-span-2" : ""}
                >
                  <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-0.5">*</span>
                    )}
                  </label>

                  {field.type === "custom" && field.render ? (
                    field.render({
                      value: form[field.name],
                      onChange: (v) => updateCustomField(field.name, v),
                      error: !!errors[field.name],
                      field,
                      formData: form,
                    })
                  ) : field.type === "text" || field.type === "number" ? (
                    <div className="relative">
                      {field.prefix && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          {field.prefix}
                        </span>
                      )}
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        value={(form[field.name] as string) || ""}
                        onChange={(e) =>
                          updateField(field.name, e.target.value, field)
                        }
                        className={`${inputBase} ${field.prefix ? "pl-7" : ""} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                      />
                    </div>
                  ) : field.type === "date" ? (
                    <input
                      type="date"
                      value={(form[field.name] as string) || ""}
                      onChange={(e) =>
                        updateField(field.name, e.target.value, field)
                      }
                      className={`${inputBase} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                    />
                  ) : field.type === "select" ? (
                    <select
                      value={(form[field.name] as string) || ""}
                      onChange={(e) =>
                        updateField(field.name, e.target.value, field)
                      }
                      className={`${inputBase} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                    >
                      <option value="">Select...</option>
                      {(() => {
                        let opts: { value: string; label: string }[] = [];
                        const editingRow = editingId
                          ? data.find((r) => r._id === editingId)
                          : undefined;
                        if (field.optionsProvider) {
                          opts = field.optionsProvider(data, editingRow?._id);
                        } else if (field.options) {
                          opts = field.options.map((o) => ({
                            value: o,
                            label: o,
                          }));
                        }
                        return opts.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ));
                      })()}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      value={(form[field.name] as string) || ""}
                      onChange={(e) =>
                        updateField(field.name, e.target.value, field)
                      }
                      rows={3}
                      className={`${inputBase} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                    />
                  ) : field.type === "toggle" ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateField(field.name, !form[field.name], field)
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form[field.name] ? "bg-primary" : "bg-muted border border-border"}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${form[field.name] ? "translate-x-6" : "translate-x-1"}`}
                      />
                    </button>
                  ) : field.type === "multiselect" ? (
                    <div className="flex flex-wrap gap-2">
                      {field.options?.map((o) => {
                        const selected = (
                          (form[field.name] as string[]) || []
                        ).includes(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => {
                              const current =
                                (form[field.name] as string[]) || [];
                              const next = selected
                                ? current.filter((x) => x !== o)
                                : [...current, o];
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

                  {errors[field.name] && (
                    <p className="text-[11px] text-destructive mt-1">
                      {field.label} is required
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all"
            >
              <Plus size={15} />
              {editingId !== null ? "Update" : "Save"}
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

      {/* ── TABLE CARD ── */}
      {!hideTable && (
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-visible">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60 rounded-t-xl overflow-visible">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                {title} Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} record{filtered.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {exportConfig && (
                <ExportMenu
                  data={filtered as Record<string, unknown>[]}
                  columns={exportConfig.columns}
                  title={exportConfig.title}
                  filename={exportConfig.filename}
                  subtitle={exportConfig.subtitle}
                  disabled={filtered.length === 0}
                />
              )}
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary w-40"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden rounded-b-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap${col.hideOnMobile ? " hidden sm:table-cell" : ""}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      className="px-4 py-10 text-center text-muted-foreground text-sm"
                    >
                      {search
                        ? "No records match your search."
                        : "No records yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr
                      key={row._id}
                      className={`hover:bg-muted/20 transition-colors ${editingId === row._id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 text-foreground text-sm${col.hideOnMobile ? " hidden sm:table-cell" : ""}`}
                        >
                          {columnRenderers && columnRenderers[col.key] ? (
                            columnRenderers[col.key](row[col.key], row, data)
                          ) : col.key === "status" ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
                                row[col.key]
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-destructive/10 text-destructive border-destructive/20"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${row[col.key] ? "bg-primary" : "bg-destructive"}`}
                              />
                              {row[col.key] ? "Active" : "Inactive"}
                            </span>
                          ) : (
                            <span className="text-foreground">
                              {String(row[col.key] ?? "")}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {deleteConfirmId === row._id ? (
                            <>
                              <span className="text-[11px] text-muted-foreground mr-1">
                                Confirm?
                              </span>
                              <button
                                onClick={() => handleDelete(row._id)}
                                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                title="Confirm delete"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                                title="Cancel"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              {viewConfig && (
                                <button
                                  onClick={() => setViewRow(row)}
                                  className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors"
                                  title="View details"
                                >
                                  <Eye size={13} />
                                </button>
                              )}
                              {onPrint && (
                                <button
                                  onClick={() => onPrint(row)}
                                  className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
                                  title="Print"
                                >
                                  <Printer size={13} />
                                </button>
                              )}
                              <button
                                onClick={() => handleEdit(row._id)}
                                className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                                title="Edit"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(row._id)}
                                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={13} />
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
      )}

      {/* ── VIEW DETAIL MODAL ── */}
      {viewConfig && (
        <Dialog
          open={!!viewRow}
          onOpenChange={(open) => !open && setViewRow(null)}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                {viewConfig.title}
              </DialogTitle>
            </DialogHeader>
            {viewRow && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
                {viewConfig.fields.map(({ key, label, mono }) => {
                  const val = viewRow[key];
                  const display =
                    typeof val === "boolean"
                      ? val
                        ? "Active"
                        : "Inactive"
                      : val != null && val !== ""
                        ? String(val)
                        : "—";
                  return (
                    <div key={key}>
                      <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p
                        className={`text-sm text-foreground break-words ${mono ? "font-mono" : "font-body"}`}
                      >
                        {display}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
              {onPrint && viewRow && (
                <button
                  onClick={() => {
                    onPrint(viewRow);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-all"
                >
                  <Printer size={13} />
                  Print
                </button>
              )}
              <button
                onClick={() => setViewRow(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
