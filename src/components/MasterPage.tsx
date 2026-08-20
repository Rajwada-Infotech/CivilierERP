import React from "react";
import { useState } from "react";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Plus,
  Eye,
  Printer,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CalendarDays,
  RotateCcw,
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
    | "custom"
    /** Full-width section heading/divider — no input, no value. Purely
     * visual grouping for forms with several logically-distinct field
     * clusters (e.g. "Reference", "Parties", "Line Items"). */
    | "section";
  required?: boolean;
  options?: string[];
  optionsProvider?: (
    data: RecordWithId[],
    currentId?: string,
    form?: Record<string, unknown>,
  ) => { value: string; label: string }[];
  asyncOptions?: () => Promise<{ value: string; label: string }[]>;
  /** For a "select" field backed by asyncOptions — once options load, seed
   * new (non-edit) records with the first option (e.g. the most recent
   * Financial Year, when the options query already sorts newest-first).
   * Never overrides a value already present, so editing an existing record
   * is unaffected. */
  defaultToFirstOption?: boolean;
  prefix?: string;
  uppercase?: boolean;
  fullWidth?: boolean;
  defaultValue?: string | boolean | string[];
  placeholder?: string;
  mode?: string;
  /** For a "select" field that depends on a parent field (e.g. Project
   * depends on Company) — return true to disable this field and show
   * disabledPlaceholder instead of the normal "Select..." + options, so a
   * child field can never be picked before its parent, and never silently
   * falls back to showing every row unfiltered. */
  disabledWhen?: (form: Record<string, unknown>) => boolean;
  disabledPlaceholder?: string;
  render?: (props: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
    formData: Record<string, unknown>;
  }) => React.ReactNode;
}

// A required "number" field is satisfied by an explicit 0 (e.g. NIL TDS,
// a 0% rate, a free-of-charge line) — only a truthiness check (`!value`)
// would wrongly treat 0 as "empty" and block save. Every other field type
// keeps the original "non-empty after trim" behavior.
function isFieldFilled(field: FieldDef, value: unknown): boolean {
  if (field.type === "number") return value !== null && value !== undefined && value !== "";
  if (typeof value === "string") return value.trim() !== "";
  return !!value;
}

export interface ColumnDef {
  key: string;
  label: string;
  hideOnMobile?: boolean;
  /** Set false to disable the click-to-sort header for a purely computed/rendered column */
  sortable?: boolean;
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
  saveButtonClass?: string;
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
    fields: {
      key: string;
      label: string;
      mono?: boolean;
      /** Custom display for this field in the view modal (e.g. a download
       *  link for an attached file) instead of the plain stringified value. */
      render?: (value: unknown, row: RecordWithId) => React.ReactNode;
    }[];
  };
  /**
   * When provided, a Print button appears per row. Called with the row record
   * so the page can open a print layout or window.print().
   */
  onPrint?: (row: RecordWithId) => void;
  rowActions?: (row: RecordWithId, data: RecordWithId[]) => React.ReactNode;
  /** Permission flags — when omitted everything is visible (default-open) */
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
  /**
   * Optional per-row lock check. Return a short reason string to grey out
   * and disable that row's Edit AND Delete buttons (shown as a tooltip),
   * or null/undefined to leave the row unlocked. Omit entirely for pages
   * with no row-level locking — existing behavior is unchanged when this
   * prop isn't passed.
   */
  isRowLocked?: (row: RecordWithId) => string | null | undefined;
  /**
   * Optional per-row check that greys out and disables only the Delete
   * button (Edit stays enabled) — for masters like Block Master where a
   * record can still be renamed/reassigned while locked, but can't be
   * removed while it has dependent child records (e.g. a Block with
   * Booked/OnHold Units under it). Combines with isRowLocked if both are
   * passed; has no effect on its own on the Edit button.
   */
  isDeleteLocked?: (row: RecordWithId) => string | null | undefined;
  /** Form field grid columns at the md breakpoint. Defaults to 2. */
  gridCols?: 2 | 3;
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
  saveButtonClass,
  externalFormPatch,
  externalFormPatchKey,
  exportConfig,
  hideTable,
  viewConfig,
  onPrint,
  rowActions,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canExport = true,
  gridCols = 2,
  isRowLocked,
  isDeleteLocked,
}) => {
  const [data, setData] = useState<RecordWithId[]>(() =>
    seedWithIds(initialData),
  );
  // A refresh (or an accidental navigation away and back) used to wipe
  // whatever was typed into the "Add" form — nothing here persisted it.
  // Restore an in-progress draft on mount so that's no longer lost; scoped
  // per `title` since each MasterPage instance is a different master.
  const draftKey = `masterpage-draft:${title}`;
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) return { ...getDefaults(fields), ...JSON.parse(saved) };
    } catch {
      // Corrupt/unparseable draft — fall through to a clean form rather
      // than crash the page over a stale localStorage value.
    }
    return getDefaults(fields);
  });
  const [viewRow, setViewRow] = useState<RecordWithId | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  // Cache for asyncOptions — keyed by field name
  const [asyncOptionsCache, setAsyncOptionsCache] = useState<
    Record<string, { value: string; label: string }[]>
  >({});

  React.useEffect(() => {
    fields.forEach((field) => {
      if (field.type === "select" && field.asyncOptions) {
        field
          .asyncOptions()
          .then((opts) => {
            setAsyncOptionsCache((prev) => ({ ...prev, [field.name]: opts }));
          })
          .catch(() => {
            toast.error(`Failed to load options for ${field.label}`);
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed defaultToFirstOption fields once their options arrive — only for a
  // record that's still untouched (new record, field not yet set), so this
  // never clobbers a value being edited.
  React.useEffect(() => {
    fields.forEach((field) => {
      if (field.type === "select" && field.defaultToFirstOption) {
        const opts = asyncOptionsCache[field.name];
        if (opts?.length) {
          setForm((prev) =>
            editingId === null && !prev[field.name]
              ? { ...prev, [field.name]: opts[0].value }
              : prev,
          );
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncOptionsCache, editingId]);

  // keep internal data in sync when initialData changes (e.g. after DB refetch)
  const prevInitialRef = React.useRef<Record<string, unknown>[]>([]);
  // tracks whether we have ever received a non-empty initialData — once true,
  // an empty array arriving later is a real "clear" event, not the mount default
  const hasSeenDataRef = React.useRef(false);
  React.useEffect(() => {
    const prev = prevInitialRef.current;
    if (initialData.length > 0) hasSeenDataRef.current = true;
    const same =
      // if both are empty AND we have never seen real data, skip (mount default)
      prev.length === 0 && initialData.length === 0 && !hasSeenDataRef.current
        ? true
        : prev.length === initialData.length &&
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
      if (f.required && !isFieldFilled(f, form[f.name])) errs[f.name] = true;
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

    if (editingId !== null) {
      const next = data.map((row) =>
        row._id === editingId ? { ...finalData, _id: editingId } : row,
      );
      const stripped = next.map(({ _id, ...rest }) => rest);
      try {
        // Await the server first — committing `next` to local state before
        // this resolved meant a rejected save (e.g. a 409 duplicate/lock)
        // still left the edited row showing in the table with no visible
        // failure, because nothing here checked for a rejection either way.
        await onDataEvent?.({
          action: "update",
          id: editingId,
          record: finalData,
          records: stripped,
        });
        setData(next);
        onDataChange?.(stripped);
        setEditingId(null);
        toast.success("Record updated successfully ✓");
        setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save. Please try again.",
        );
      }
    } else {
      const newId = `record-${Date.now()}`;
      const newRecord: RecordWithId = { ...finalData, _id: newId };
      const next = [...data, newRecord];
      const stripped = next.map(({ _id, ...rest }) => rest);
      try {
        // Same fix as the update branch above — a rejected add (e.g. the
        // Block/Unit duplicate guard returning 409) must not land in local
        // state or show a success toast just because nothing threw yet.
        const result = await onDataEvent?.({
          action: "add",
          record: finalData,
          records: stripped,
        });
        setData(next);
        onDataChange?.(stripped);
        toast.success("Record saved successfully ✓");
        setForm({
          ...getDefaults(fields),
          ...(externalFormPatch ?? {}),
          ...(result && typeof result === "object" && !Array.isArray(result)
            ? result
            : {}),
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save. Please try again.",
        );
      }
    }
  };

  const handleEdit = (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    // Re-apply externalFormPatch (e.g. __blocks/__paymentPlans) on top of the
    // row data. Without this, entering edit mode replaces the whole form
    // with just the row's own fields, wiping out any lookup data a page
    // injected via externalFormPatch — which is only ever applied once, on
    // mount, via a separate effect keyed on externalFormPatchKey. That left
    // any optionsProvider depending on it (e.g. Block filtered by Project)
    // with nothing to read and rendering as an empty "Select..." dropdown
    // as soon as Edit was clicked.
    setForm({ ...row, ...(externalFormPatch ?? {}) });
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    // Compute next state first so we can pass records to onDataEvent
    const next = data.filter((r) => r._id !== id);
    const stripped = next.map(({ _id, ...rest }) => rest);
    try {
      await onDataEvent?.({ action: "delete", id, records: stripped });
      // API confirmed — now update local state
      setData(next);
      onDataChange?.(stripped);
      setDeleteConfirmId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
      }
      toast.success("Record deleted");
    } catch (err) {
      setDeleteConfirmId(null);
      toast.error(
        err instanceof Error ? err.message : "Failed to delete. Please try again.",
      );
    }
  };

  const handleReset = () => {
    setForm({ ...getDefaults(fields), ...(externalFormPatch ?? {}) });
    setEditingId(null);
    setErrors({});
  };

  const defaults = { ...getDefaults(fields), ...(externalFormPatch ?? {}) };
  const isDirty = Object.keys(form).some(
    (k) => String(form[k] ?? "") !== String(defaults[k] ?? "")
  );

  // Keep the draft in sync with what's actually typed — cleared the moment
  // the form goes back to a clean/default state (a successful save or an
  // explicit Reset both do this via setForm(defaults), so no separate
  // "clear on save" call is needed here). Only while adding a new record —
  // editingId !== null means the form was seeded from an existing row, and
  // persisting that as a generic "draft" risks it reappearing over a
  // different row entirely after a refresh.
  React.useEffect(() => {
    if (editingId !== null) return;
    try {
      if (isDirty) localStorage.setItem(draftKey, JSON.stringify(form));
      else localStorage.removeItem(draftKey);
    } catch {
      // localStorage unavailable (private browsing quota, etc.) — the
      // draft simply won't persist; nothing else here depends on it.
    }
  }, [form, editingId, isDirty, draftKey]);

  const canSave = fields.every((f) => !f.required || isFieldFilled(f, form[f.name]));

  const filtered = data.filter((row) => {
    if (!search) return true;
    return Object.values(row).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase()),
    );
  });

  // Numeric-aware-then-string comparator — most master data is either plain
  // numbers/dates (sort numerically) or free text (sort alphabetically);
  // trying Number() first and falling back to localeCompare covers both
  // without per-column configuration.
  const sorted = !sortKey ? filtered : [...filtered].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av), bn = Number(bv);
    const cmp = (Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "")
      ? an - bn
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const inputBase =
    "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";

  return (
    <div className="space-y-5">
      {/* ── FORM CARD ── */}
      {(canCreate || canEdit) && <div
        className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden"
        // Enter inside a text/number/date/select field must not act like a
        // form submit — there's no <form> here, but this still guards
        // against it acting as one accidentally (e.g. a future <form> wrap,
        // or a browser/extension quirk). Textareas keep Enter = newline;
        // buttons (Save/Reset/etc.) keep Enter = activate, since suppressing
        // that would break keyboard-only use of the form's own actions.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "TEXTAREA" || tag === "BUTTON") return;
          e.preventDefault();
        }}
      >
        {/* Header — title only */}
        <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20 rounded-t-xl">
          <div>
            <h2 className="font-heading font-semibold text-foreground text-sm">
              {editingId !== null ? `Edit ${title}` : `Add ${title}`}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {editingId !== null
                ? "Modify the details below and save."
                : fields.some((f) => f.required)
                  ? <>Fields marked <span className="text-destructive">*</span> are required</>
                  : "Fill in the details to create a new record."}
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className={`grid grid-cols-1 gap-4 ${gridCols === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            {fields.map((field) => {
              const isFullWidth =
                field.fullWidth || field.type === "textarea" || field.type === "section";
              return (
                <div
                  key={field.name}
                  className={isFullWidth ? (gridCols === 3 ? "md:col-span-3" : "md:col-span-2") : ""}
                >
                  {field.type !== "toggle" && field.type !== "section" && field.label && (
                    <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-0.5">*</span>
                      )}
                    </label>
                  )}

                  {field.type === "section" ? (
                    <div className={fields[0] === field ? "" : "pt-1 -mb-1"}>
                      <p className="text-[11px] uppercase tracking-widest font-heading font-semibold text-foreground/80 pb-1.5 border-b border-border/70">
                        {field.label}
                      </p>
                    </div>
                  ) : field.type === "custom" && field.render ? (
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
                        value={
                          form[field.name] !== null && form[field.name] !== undefined
                            ? (form[field.name] as string | number)
                            : ""
                        }
                        onChange={(e) =>
                          updateField(field.name, e.target.value, field)
                        }
                        className={`${inputBase} ${field.prefix ? "pl-7" : ""} ${errors[field.name] ? "border-destructive" : "border-border"}`}
                      />
                    </div>
                  ) : field.type === "date" ? (
                    <div className="relative">
                      <CalendarDays
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70"
                      />
                      <input
                        type="date"
                        value={(form[field.name] as string) || ""}
                        onChange={(e) =>
                          updateField(field.name, e.target.value, field)
                        }
                        className={`${inputBase} pl-8 ${errors[field.name] ? "border-destructive" : "border-border"} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                      />
                    </div>
                  ) : field.type === "select" ? (
                    (() => {
                      const isDisabled = field.disabledWhen?.(form) ?? false;
                      return (
                        <div className="relative">
                          <select
                            value={(form[field.name] as string) || ""}
                            onChange={(e) =>
                              updateField(field.name, e.target.value, field)
                            }
                            disabled={isDisabled}
                            className={`${inputBase} appearance-none pr-9 ${errors[field.name] ? "border-destructive" : "border-border"} ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            <option value="">
                              {isDisabled ? (field.disabledPlaceholder ?? "Select...") : "Select..."}
                            </option>
                            {!isDisabled && (() => {
                              let opts: { value: string; label: string }[] = [];
                              const editingRow = editingId
                                ? data.find((r) => r._id === editingId)
                                : undefined;
                              if (field.optionsProvider) {
                                opts = field.optionsProvider(
                                  data,
                                  editingRow?._id,
                                  form,
                                );
                              } else if (asyncOptionsCache[field.name]) {
                                opts = asyncOptionsCache[field.name];
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
                          <ChevronDown
                            size={14}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                        </div>
                      );
                    })()
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
                    <div className="flex items-center gap-3 pt-7">
                      <button
                        type="button"
                        onClick={() =>
                          updateField(field.name, !form[field.name], field)
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${form[field.name] ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form[field.name] ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                        {field.label} —{" "}
                        <span className={form[field.name] ? "text-emerald-600" : "text-foreground"}>
                          {form[field.name] ? "Active" : "Inactive"}
                        </span>
                      </span>
                    </div>
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

        </div>

        {/* Footer — actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            {canSave
              ? <span className="text-emerald-500 font-medium">Ready to save</span>
              : fields.some((f) => f.required)
                ? "Fill in the required fields to save"
                : ""}
          </p>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              onClick={handleReset}
              disabled={!isDirty && editingId === null}
              className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={12} />
              {editingId !== null ? "Cancel" : "Reset"}
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || (editingId === null ? !canCreate : !canEdit)}
              className={`flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg text-sm font-heading font-semibold ${saveButtonClass || "gradient-accent"} text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity whitespace-nowrap`}
            >
              {editingId !== null ? <Check size={14} /> : <Plus size={14} />}
              {editingId !== null ? `Update ${title}` : `Save ${title}`}
            </button>
          </div>
        </div>
      </div>}

      {/* ── TABLE CARD ── */}
      {!hideTable && (
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-visible">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60 rounded-t-xl overflow-visible">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                {title} Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} record{filtered.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {exportConfig && canExport && (
                <ExportMenu
                  data={sorted as Record<string, unknown>[]}
                  columns={exportConfig.columns}
                  title={exportConfig.title}
                  filename={exportConfig.filename}
                  subtitle={exportConfig.subtitle}
                  disabled={filtered.length === 0}
                />
              )}
              <div className="relative flex-1 sm:flex-none">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-44"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden rounded-b-xl thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {columns.map((col) => {
                    const canSort = col.sortable !== false;
                    const active = sortKey === col.key;
                    return (
                      <th
                        key={col.key}
                        onClick={canSort ? () => toggleSort(col.key) : undefined}
                        className={`px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap select-none${col.hideOnMobile ? " hidden sm:table-cell" : ""}${canSort ? " cursor-pointer hover:text-foreground transition-colors" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {canSort && (
                            <span className="text-muted-foreground/50">
                              {active && sortDir === "asc" ? (
                                <ChevronUp size={11} className="text-primary" />
                              ) : active && sortDir === "desc" ? (
                                <ChevronDown size={11} className="text-primary" />
                              ) : (
                                <ChevronsUpDown size={11} />
                              )}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.length === 0 ? (
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
                  sorted.map((row) => {
                    const lockReason = isRowLocked?.(row) || null;
                    const deleteOnlyLockReason = isDeleteLocked?.(row) || null;
                    // None of the backends these pages call return the
                    // inserted row's real ID on POST — so a freshly-added
                    // row sits on this client-side placeholder ID until the
                    // page's invalidateQueries refetch replaces it with the
                    // real one. Editing/deleting during that brief window
                    // would PUT/DELETE to a NaN id (parseInt on
                    // "record-<timestamp>") and fail. Lock the row instead
                    // of letting that be the user's first sign anything was
                    // wrong.
                    const pendingLockReason = row._id.startsWith("record-")
                      ? "Still saving — try again in a moment"
                      : null;
                    return (
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
                              {rowActions?.(row, data)}
                              {canEdit && (
                                (lockReason || pendingLockReason) ? (
                                  <button
                                    disabled
                                    className="p-1.5 rounded-lg text-muted-foreground/30 cursor-not-allowed"
                                    title={lockReason || pendingLockReason || undefined}
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleEdit(row._id)}
                                    className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-400/10 transition-colors"
                                    title="Edit"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                )
                              )}
                              {canDelete && (
                                (lockReason || deleteOnlyLockReason || pendingLockReason) ? (
                                  <button
                                    disabled
                                    className="p-1.5 rounded-lg text-muted-foreground/30 cursor-not-allowed"
                                    title={lockReason || deleteOnlyLockReason || pendingLockReason || undefined}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setDeleteConfirmId(row._id)}
                                    className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )
                              )}
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
                {viewConfig.fields.map(({ key, label, mono, render }) => {
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
                      {render ? (
                        render(val, viewRow)
                      ) : (
                        <p
                          className={`text-sm text-foreground break-words ${mono ? "font-mono" : "font-body"}`}
                        >
                          {display}
                        </p>
                      )}
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