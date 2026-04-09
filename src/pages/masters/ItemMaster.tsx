import React, { useState, useCallback, useRef, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useHsn } from "@/contexts/HsnContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getItems,
  addItem,
  updateItem,
  deleteItem,
  type DbItem,
} from "@/api/itemMasterApi";
import { getItemGroups } from "@/api/itemGroupApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HsnCode {
  code: string;
  description: string;
}

// UI-facing shape (flat, easy to bind to form fields)
interface Item {
  _id: string; // maps to M_Id
  description: string; // maps to M_Name
  itemCode: string; // maps to M_Group (the short identity code)
  shortCode: string; // maps to M_Group as well (same field used as code)
  itemType: "Service" | "Goods" | ""; // maps to M_Type
  hsnCode: string; // maps to M_HSN
  showTaxCalculated: boolean; // maps to M_IdentityCode
  taxRate: number; // derived: M_IGST ?? (M_CGST + M_SGST) ?? 0
  belongsTo: string; // maps to Parent_Id (the group UUID)
  discontinue: "active" | "discontinued"; // not in DB — kept for UI only
}

// Map a DB row → UI item
function dbToItem(row: DbItem): Item {
  return {
    _id: row.M_Id,
    description: row.M_Name || "",
    itemCode: row.M_Group || "",
    shortCode: row.M_Group || "",
    itemType: (row.M_Type as Item["itemType"]) || "",
    hsnCode: row.M_HSN || "",
    showTaxCalculated: !!row.M_IdentityCode,
    taxRate: row.M_IGST ?? (row.M_CGST ?? 0) + (row.M_SGST ?? 0),
    belongsTo: row.Parent_Id || "",
    discontinue: "active", // DB has no discontinue column — default active
  };
}

// Map form state → POST/PUT payload
function itemToPayload(form: Omit<Item, "_id">) {
  const cgst = form.taxRate / 2;
  const sgst = form.taxRate / 2;
  const igst = form.taxRate;
  return {
    M_Name: form.description,
    M_Description: form.description,
    M_Type: form.itemType || null,
    M_Group: form.shortCode || null,
    M_HSN: form.hsnCode || null,
    M_IdentityCode: form.showTaxCalculated ? 1 : 0,
    M_CGST: form.showTaxCalculated ? cgst : null,
    M_IGST: form.showTaxCalculated ? igst : null,
    M_SGST: form.showTaxCalculated ? sgst : null,
    M_BelongsTo: null,
    Parent_Id: form.belongsTo || null,
  };
}

const EMPTY_FORM: Omit<Item, "_id"> = {
  description: "",
  itemCode: "",
  shortCode: "",
  itemType: "",
  hsnCode: "",
  showTaxCalculated: false,
  taxRate: 0,
  belongsTo: "",
  discontinue: "active",
};

// ── Searchable HSN Dropdown (unchanged from original) ─────────────────────────
const HsnDropdown: React.FC<{
  value: string;
  onChange: (code: string) => void;
  hsnCodes: HsnCode[];
}> = ({ value, onChange, hsnCodes }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = hsnCodes.find((h) => h.code === value);
  const filtered = query.trim()
    ? hsnCodes.filter(
        (h) =>
          h.code.includes(query) ||
          h.description.toLowerCase().includes(query.toLowerCase()),
      )
    : hsnCodes;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all min-w-0"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0 overflow-hidden">
            <span className="font-mono text-primary text-xs shrink-0 whitespace-nowrap">
              {selected.code}
            </span>
            <span className="text-muted-foreground text-xs truncate hidden sm:block">
              {selected.description}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-xs sm:text-sm">
            Select HSN code...
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or description..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {hsnCodes.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                No HSN codes available
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                No HSN codes found
              </div>
            ) : (
              filtered.map((h) => (
                <button
                  key={h.code}
                  type="button"
                  onClick={() => {
                    onChange(h.code);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${h.code === value ? "bg-primary/10" : ""}`}
                >
                  <span className="font-mono text-primary shrink-0 text-xs w-[5.5rem]">
                    {h.code}
                  </span>
                  <span className="text-muted-foreground text-xs truncate min-w-0">
                    {h.description}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Field wrapper (unchanged) ─────────────────────────────────────────────────
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
  <div>
    <label className="block text-xs font-heading text-muted-foreground mb-1">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-xs text-destructive mt-1">{label} is required</p>
    )}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${err ? "border-destructive" : "border-border"}`;

// ── Main Component ────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
  const { activeHsnCodes, hsnRecords } = useHsn();
  const queryClient = useQueryClient();

  // ── DB queries ──────────────────────────────────────────────────────────
  const {
    data: dbItems = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });

  // Load item groups from DB so the "Belongs To" dropdown is live
  const { data: dbGroups = [] } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
  });

  const itemGroups = Array.isArray(dbGroups)
    ? dbGroups.map((g: any) => ({
        id: String(g.M_Id),
        description: g.M_Name || "",
        code: g.M_Group || "",
      }))
    : [];

  const data: Item[] = (Array.isArray(dbItems) ? dbItems : []).map(dbToItem);

  // ── Local state ──────────────────────────────────────────────────────────
  const [form, setFormState] = useState<Omit<Item, "_id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = useCallback(
    (key: keyof Omit<Item, "_id">, val: unknown) => {
      setFormState((p) => {
        const next = { ...p, [key]: val };
        if (key === "hsnCode") {
          const hsn = hsnRecords.find((h) => h.code === val);
          if (hsn && next.showTaxCalculated) {
            next.taxRate = hsn.igstRate || hsn.cgstRate + hsn.sgstRate;
          }
        }
        if (key === "showTaxCalculated" && val === true && p.hsnCode) {
          const hsn = hsnRecords.find((h) => h.code === p.hsnCode);
          if (hsn) next.taxRate = hsn.igstRate || hsn.cgstRate + hsn.sgstRate;
        }
        if (key === "showTaxCalculated" && val === false) {
          next.taxRate = 0;
        }
        return next;
      });
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors, hsnRecords],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.description.trim()) errs.description = true;
    if (!form.shortCode.trim()) errs.shortCode = true;
    if (!form.itemType) errs.itemType = true;
    if (!form.belongsTo) errs.belongsTo = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateItem(editingId, itemToPayload(form));
        toast.success("Item updated successfully ✓");
        setEditingId(null);
      } else {
        await addItem(itemToPayload(form));
        toast.success("Item saved successfully ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["item-master"] });
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
      await deleteItem(id);
      toast.success("Item deleted");
      await queryClient.invalidateQueries({ queryKey: ["item-master"] });
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

  // ── Loading / error state ────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading items...
      </div>
    );

  if (error)
    return (
      <div className="p-6 text-destructive">
        Failed to load items. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Item Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Item Master
      </h1>

      {/* ── Form ── */}
      <div className="rounded-xl bg-card border border-border p-4 sm:p-5 mb-5">
        <h2 className="font-heading font-semibold text-foreground text-lg mb-4">
          {editingId ? "Edit Item" : "Add Item"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Description */}
          <Field label="Description" required error={errors.description}>
            <input
              type="text"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className={inputCls(errors.description)}
              placeholder="Item description"
            />
          </Field>

          {/* Short Code (used as M_Group — the item's identity code) */}
          <Field label="Short Code" required error={errors.shortCode}>
            <input
              type="text"
              value={form.shortCode}
              onChange={(e) => set("shortCode", e.target.value.toUpperCase())}
              className={inputCls(errors.shortCode)}
              placeholder="e.g. CEM"
              maxLength={6}
            />
          </Field>

          {/* Type of Item */}
          <Field label="Type of Item" required error={errors.itemType}>
            <select
              value={form.itemType}
              onChange={(e) => set("itemType", e.target.value)}
              className={inputCls(errors.itemType)}
            >
              <option value="">Select type...</option>
              <option value="Service">Service</option>
              <option value="Goods">Goods</option>
            </select>
          </Field>

          {/* HSN Code */}
          <Field label="HSN Code">
            <HsnDropdown
              value={form.hsnCode}
              onChange={(val) => set("hsnCode", val)}
              hsnCodes={activeHsnCodes}
            />
          </Field>

          {/* Belongs To — live from DB */}
          <Field
            label="Belongs To (Item Group)"
            required
            error={errors.belongsTo}
          >
            <select
              value={form.belongsTo}
              onChange={(e) => set("belongsTo", e.target.value)}
              className={inputCls(errors.belongsTo)}
            >
              <option value="">Select group...</option>
              {itemGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.description}
                  {g.code ? ` (${g.code})` : ""}
                </option>
              ))}
            </select>
          </Field>

          {/* Show Tax Calculated */}
          <div className="flex flex-col gap-2 pt-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  set("showTaxCalculated", !form.showTaxCalculated)
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.showTaxCalculated ? "bg-primary" : "bg-muted"}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform ${form.showTaxCalculated ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
              <span className="text-sm font-heading text-foreground">
                Show Tax Calculated
              </span>
            </div>
            {form.showTaxCalculated && (
              <div className="flex items-center gap-2 mt-1">
                {form.hsnCode ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="number"
                        value={form.taxRate}
                        readOnly
                        className="w-24 px-3 py-1.5 rounded-lg text-sm font-mono bg-muted/50 border border-border text-primary cursor-not-allowed pr-8"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-heading">
                        %
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      auto-filled from HSN
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={form.taxRate === 0 ? "" : form.taxRate}
                        onChange={(e) =>
                          set("taxRate", parseFloat(e.target.value) || 0)
                        }
                        placeholder="0"
                        className="w-24 px-3 py-1.5 rounded-lg text-sm font-mono bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary pr-8"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-heading">
                        %
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      enter tax rate
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editingId ? "Update" : "Save"}
          </button>
          <button
            onClick={handleReset}
            className="px-5 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <colgroup>
              <col className="w-auto" /> {/* Description */}
              <col className="w-[6rem]" /> {/* Short Code */}
              <col className="w-[6rem]" /> {/* Type */}
              <col className="w-[7rem]" /> {/* HSN */}
              <col className="w-[10rem]" />
              {/* Group */}
              <col className="w-[4rem]" /> {/* Tax */}
              <col className="w-[5rem]" /> {/* Actions */}
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                {[
                  "Description",
                  "Short Code",
                  "Type",
                  "HSN",
                  "Group",
                  "Tax",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-heading uppercase tracking-wide text-muted-foreground whitespace-nowrap"
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
                    colSpan={7}
                    className="px-4 py-8 text-center text-muted-foreground text-sm"
                  >
                    {search
                      ? "No items match your search."
                      : "No items yet. Add one above."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const groupName =
                    itemGroups.find((g) => g.id === row.belongsTo)
                      ?.description || row.belongsTo;
                  return (
                    <tr
                      key={row._id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-foreground max-w-[200px] truncate">
                        {row.description}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.shortCode}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.itemType === "Service" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}
                        >
                          {row.itemType}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.hsnCode ? (
                          <span className="font-mono text-xs text-primary">
                            {row.hsnCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {groupName || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.showTaxCalculated ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-primary/10 text-primary whitespace-nowrap">
                            {row.taxRate}%
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-heading bg-muted text-muted-foreground">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {deleteConfirmId === row._id ? (
                            <>
                              <button
                                onClick={() => handleDelete(row._id)}
                                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(row._id)}
                                className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(row._id)}
                                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 size={14} />
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
    </>
  );
};

export default ItemMaster;
