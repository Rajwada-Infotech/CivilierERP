import React, { useState, useCallback, useRef, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getItems,
  addItem,
  updateItem,
  deleteItem,
  type DbItem,
} from "@/api/itemMasterApi";
import { getItemGroups } from "@/api/itemGroupApi";
import { getUomList } from "@/api/uomApi";
import { getHsn } from "@/api/hsnApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HsnCode {
  code: string;
  description: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

interface Item {
  _id: string;
  itemName: string;
  description: string;
  shortCode: string;
  itemType: "Service" | "Goods" | "";
  hsnCode: string;
  cgst: number;
  sgst: number;
  igst: number;
  belongsTo: string;
  uomCode: string;
}

function dbToItem(row: DbItem): Item {
  return {
    _id: row.M_Id,
    itemName: row.M_Name || "",
    description: row.M_Description || "",
    shortCode: row.M_code || "",           // ← M_code stores short code
    itemType: (row.M_Type as Item["itemType"]) || "",
    hsnCode: row.M_HSN || "",
    cgst: row.M_CGST ?? 0,
    sgst: row.M_SGST ?? 0,
    igst: row.M_IGST ?? 0,
    belongsTo: row.Parent_Id || "",        // ← Parent_Id stores group UUID
    uomCode: row.M_UOM || "",
  };
}

function itemToPayload(form: Omit<Item, "_id">, groupName: string) {
  return {
    M_Name: form.itemName,
    M_Description: form.description || form.itemName,
    M_Type: form.itemType || null,
    M_code: form.shortCode || null,        // ← short code → M_code
    M_Group: groupName || null,            // ← group Name → M_Group
    M_BelongsTo: form.belongsTo || null,   // ← group UUID → M_BelongsTo
    Parent_Id: form.belongsTo || null,     // ← group UUID → Parent_Id
    M_HSN: form.hsnCode || null,
    M_IdentityCode: (form.cgst > 0 || form.sgst > 0 || form.igst > 0) ? 1 : 0,
    M_CGST: form.cgst || null,
    M_SGST: form.sgst || null,
    M_IGST: form.igst || null,
    M_UOM: form.uomCode || null,
  };
}

const EMPTY_FORM: Omit<Item, "_id"> = {
  itemName: "",
  description: "",
  shortCode: "",
  itemType: "",
  hsnCode: "",
  cgst: 0,
  sgst: 0,
  igst: 0,
  belongsTo: "",
  uomCode: "",
};

// ── Searchable HSN Dropdown ───────────────────────────────────────────────────
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
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0 overflow-hidden">
            <span className="font-mono text-primary text-xs shrink-0">
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
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${
                    h.code === value ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="font-mono text-primary shrink-0 text-xs w-[6rem]">
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
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;

// ── Main Component ────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
  const queryClient = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: dbItems = [], isLoading, error } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
    staleTime: 5 * 60 * 1000,
  });

  const { data: dbGroups = [] } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
    staleTime: 5 * 60 * 1000,
  });

  const { data: dbUoms = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUomList,
    staleTime: 5 * 60 * 1000,
  });

  const { data: dbHsn = [] } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mapped options ────────────────────────────────────────────────────────
  const itemGroups = Array.isArray(dbGroups)
    ? dbGroups.map((g: any) => ({
        id: String(g.M_Id),
        description: g.M_Name || "",
        code: g.M_Group || "",
      }))
    : [];

  const uomOptions = Array.isArray(dbUoms)
    ? dbUoms
        .filter((u: any) => u.IsActive !== false)
        .map((u: any) => ({
          value: u.UOMCode,
          label: u.Symbol ? `${u.UOMName} (${u.Symbol})` : u.UOMName,
        }))
    : [];

  const hsnCodes: HsnCode[] = Array.isArray(dbHsn)
    ? dbHsn
        .filter((h: any) => h.HStatus !== false)
        .map((h: any) => ({
          code: h.HCode || "",
          description: h.HShortDescription || h.HDescription || "",
          cgstRate: h.HCGST ?? 0,
          sgstRate: h.HSGST ?? 0,
          igstRate: h.HIGST ?? 0,
        }))
    : [];

  const data: Item[] = (Array.isArray(dbItems) ? dbItems : []).map(dbToItem);

  // ── Local state ───────────────────────────────────────────────────────────
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
          const hsn = hsnCodes.find((h) => h.code === val);
          if (hsn) {
            next.cgst = hsn.cgstRate ?? 0;
            next.sgst = hsn.sgstRate ?? 0;
            next.igst = hsn.igstRate ?? 0;
          } else {
            next.cgst = 0;
            next.sgst = 0;
            next.igst = 0;
          }
        }
        return next;
      });
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors, hsnCodes],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.itemName.trim()) errs.itemName = true;
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
      // ← resolve group name from selected group id
      const groupName =
        itemGroups.find((g) => g.id === form.belongsTo)?.description || "";

      if (editingId) {
        await updateItem(editingId, itemToPayload(form, groupName));
        toast.success("Item updated successfully ✓");
        setEditingId(null);
      } else {
        await addItem(itemToPayload(form, groupName));
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

          {/* Item Name */}
          <Field label="Item Name" required error={errors.itemName}>
            <input
              type="text"
              value={form.itemName}
              onChange={(e) => set("itemName", e.target.value)}
              className={inputCls(errors.itemName)}
              placeholder="e.g. Cement UltraTech"
            />
          </Field>

          {/* Short Code */}
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

          {/* Item Group */}
          <Field label="Item Group (Parent)" required error={errors.belongsTo}>
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

          {/* UOM */}
          <Field label="Unit of Measure (UOM)">
            <select
              value={form.uomCode}
              onChange={(e) => set("uomCode", e.target.value)}
              className={inputCls()}
            >
              <option value="">Select UOM...</option>
              {uomOptions.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
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
              hsnCodes={hsnCodes}
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <input
              type="text"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className={inputCls()}
              placeholder="Additional description (optional)"
            />
          </Field>

        </div>

        {/* ── Tax Rates ── */}
        <div className="mt-4">
          <p className="text-xs font-heading text-muted-foreground mb-2 uppercase tracking-wide">
            Tax Rates{" "}
            {form.hsnCode && (
              <span className="text-primary ml-1">(auto-filled from HSN)</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-4">

            <Field label="CGST (%)">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.cgst === 0 ? "" : form.cgst}
                  onChange={(e) => set("cgst", parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className={inputCls() + " pr-8"}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </Field>

            <Field label="SGST (%)">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.sgst === 0 ? "" : form.sgst}
                  onChange={(e) => set("sgst", parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className={inputCls() + " pr-8"}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </Field>

            <Field label="IGST (%)">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.igst === 0 ? "" : form.igst}
                  onChange={(e) => set("igst", parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className={inputCls() + " pr-8"}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </Field>

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
          <table className="w-full text-sm min-w-[900px]">
            <colgroup>
              <col className="w-auto" />
              <col className="w-[6rem]" />
              <col className="w-[10rem]" />
              <col className="w-[6rem]" />
              <col className="w-[6rem]" />
              <col className="w-[7rem]" />
              <col className="w-[4rem]" />
              <col className="w-[4rem]" />
              <col className="w-[4rem]" />
              <col className="w-[5rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                {[
                  "Item Name",
                  "Short Code",
                  "Group",
                  "UOM",
                  "Type",
                  "HSN",
                  "CGST",
                  "SGST",
                  "IGST",
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
                    colSpan={10}
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
                  const uomLabel =
                    uomOptions.find((u) => u.value === row.uomCode)?.label ||
                    row.uomCode;
                  return (
                    <tr
                      key={row._id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-foreground max-w-[200px] truncate font-medium">
                        {row.itemName || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {row.shortCode || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {groupName || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {uomLabel ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-heading bg-muted text-foreground whitespace-nowrap">
                            {uomLabel}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                            row.itemType === "Service"
                              ? "bg-blue-500/10 text-blue-400"
                              : "bg-orange-500/10 text-orange-400"
                          }`}
                        >
                          {row.itemType || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.hsnCode ? (
                          <span className="font-mono text-xs text-primary">
                            {row.hsnCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.cgst > 0 ? (
                          <span className="font-mono text-xs text-primary">
                            {row.cgst}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.sgst > 0 ? (
                          <span className="font-mono text-xs text-primary">
                            {row.sgst}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.igst > 0 ? (
                          <span className="font-mono text-xs text-primary">
                            {row.igst}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
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