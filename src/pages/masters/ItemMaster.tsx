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
} from "lucide-react";
import { toast } from "sonner";
import { useHsn } from "@/contexts/HsnContext";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ItemGroup {
  code: string;
  description: string;
}

interface HsnCode {
  code: string;
  description: string;
}

interface Item {
  _id: string;
  description: string;
  itemCode: string;
  shortCode: string;
  itemType: "Service" | "Goods" | "";
  hsnCode: string;
  showTaxCalculated: boolean;
  taxRate: number;
  belongsTo: string;
  discontinue: "active" | "discontinued";
}

// ── Static item groups ────────────────────────────────────────────────────────
const ITEM_GROUPS: ItemGroup[] = [
  { code: "RM", description: "Raw Materials" },
  { code: "FG", description: "Finished Goods" },
  { code: "SVC", description: "Services" },
  { code: "CG", description: "Capital Goods" },
];

// ── Auto-generate item code ───────────────────────────────────────────────────
let _itemCounter = 4;
function generateItemCode(): string {
  _itemCounter += 1;
  return `ITM${String(_itemCounter).padStart(4, "0")}`;
}

const INITIAL_DATA: Item[] = [
  {
    _id: "seed-1",
    description: "Cement OPC 53 Grade",
    itemCode: "ITM0001",
    shortCode: "CEM",
    itemType: "Goods",
    hsnCode: "",
    showTaxCalculated: true,
    taxRate: 18,
    belongsTo: "RM",
    discontinue: "active",
  },
  {
    _id: "seed-2",
    description: "Steel TMT Bar 12mm",
    itemCode: "ITM0002",
    shortCode: "STL",
    itemType: "Goods",
    hsnCode: "",
    showTaxCalculated: true,
    taxRate: 18,
    belongsTo: "RM",
    discontinue: "active",
  },
  {
    _id: "seed-3",
    description: "Site Survey Service",
    itemCode: "ITM0003",
    shortCode: "SVY",
    itemType: "Service",
    hsnCode: "",
    showTaxCalculated: false,
    taxRate: 0,
    belongsTo: "SVC",
    discontinue: "active",
  },
  {
    _id: "seed-4",
    description: "JCB Rental Service",
    itemCode: "ITM0004",
    shortCode: "JCB",
    itemType: "Service",
    hsnCode: "",
    showTaxCalculated: false,
    taxRate: 0,
    belongsTo: "SVC",
    discontinue: "discontinued",
  },
];

const EMPTY_FORM: Omit<Item, "_id" | "itemCode"> = {
  description: "",
  shortCode: "",
  itemType: "",
  hsnCode: "",
  showTaxCalculated: false,
  taxRate: 0,
  belongsTo: "",
  discontinue: "active",
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

  const handleOpen = () => {
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
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
              onClick={handleClear}
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

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          {/* Search input */}
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

          {/* Options list */}
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
                  onClick={() => handleSelect(h.code)}
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
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${err ? "border-destructive" : "border-border"}`;

// ── Main Component ────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
  const { activeHsnCodes, hsnRecords } = useHsn();
  const [data, setData] = useState<Item[]>(INITIAL_DATA);
  const [form, setForm] = useState<Omit<Item, "_id">>({
    ...EMPTY_FORM,
    itemCode: generateItemCode(),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const set = useCallback(
    (key: keyof Omit<Item, "_id">, val: unknown) => {
      setForm((p) => {
        const next = { ...p, [key]: val };
        // When HSN code changes and tax is enabled, auto-fill the rate
        if (key === "hsnCode") {
          const hsn = hsnRecords.find((h) => h.code === val);
          if (hsn && next.showTaxCalculated) {
            next.taxRate = hsn.igstRate || hsn.cgstRate + hsn.sgstRate;
          }
        }
        // When toggle turns ON and an HSN is already selected, auto-fill
        if (key === "showTaxCalculated" && val === true && p.hsnCode) {
          const hsn = hsnRecords.find((h) => h.code === p.hsnCode);
          if (hsn) next.taxRate = hsn.igstRate || hsn.cgstRate + hsn.sgstRate;
        }
        // When toggle turns OFF, clear taxRate
        if (key === "showTaxCalculated" && val === false) {
          next.taxRate = 0;
        }
        return next;
      });
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors, hsnRecords],
  );

  const regenerateCode = () => set("itemCode", generateItemCode());

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.description.trim()) errs.description = true;
    if (!form.shortCode.trim()) errs.shortCode = true;
    if (!form.itemType) errs.itemType = true;
    if (!form.belongsTo) errs.belongsTo = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (editingId) {
      setData((prev) =>
        prev.map((r) =>
          r._id === editingId ? { ...form, _id: editingId } : r,
        ),
      );
      setEditingId(null);
      toast.success("Item updated successfully ✓");
    } else {
      setData((prev) => [...prev, { ...form, _id: `item-${Date.now()}` }]);
      toast.success("Item saved successfully ✓");
    }
    setForm({ ...EMPTY_FORM, itemCode: generateItemCode() });
  };

  const handleEdit = (id: string) => {
    const row = data.find((r) => r._id === id);
    if (!row) return;
    const { _id, ...rest } = row;
    setForm(rest);
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setForm({ ...EMPTY_FORM, itemCode: generateItemCode() });
    }
    setData((prev) => prev.filter((r) => r._id !== id));
    setDeleteConfirmId(null);
    toast.success("Item deleted");
  };

  const handleReset = () => {
    setForm({ ...EMPTY_FORM, itemCode: generateItemCode() });
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

          {/* Item Code */}
          <Field label="Item Code (Auto Generated)">
            <div className="flex gap-2">
              <input
                type="text"
                value={form.itemCode}
                readOnly
                className="flex-1 px-3 py-2 rounded-lg text-sm font-body bg-muted/50 border border-border text-muted-foreground cursor-not-allowed"
              />
              {!editingId && (
                <button
                  type="button"
                  onClick={regenerateCode}
                  title="Regenerate code"
                  className="px-3 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-muted-foreground transition-colors"
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
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

          {/* HSN Code — live from HSN Master via HsnContext */}
          <Field label="HSN Code">
            <HsnDropdown
              value={form.hsnCode}
              onChange={(val) => set("hsnCode", val)}
              hsnCodes={activeHsnCodes}
            />
          </Field>

          {/* Belongs To */}
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
              {ITEM_GROUPS.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.description}
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
                  // HSN selected — show auto-filled rate as read-only
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
                  // No HSN — manual entry
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

          {/* Status */}
          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-2">
              Status
            </label>
            <div className="flex items-center gap-6">
              {(["active", "discontinued"] as const).map((val) => (
                <label
                  key={val}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="discontinue"
                    value={val}
                    checked={form.discontinue === val}
                    onChange={() => set("discontinue", val)}
                    className="accent-primary w-4 h-4"
                  />
                  <span className="text-sm font-heading text-foreground capitalize">
                    {val === "active" ? "Active" : "Discontinued"}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all"
          >
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
              <col className="w-[8rem]" /> {/* Item Code */}
              <col className="w-auto" /> {/* Description */}
              <col className="w-[6rem]" /> {/* Short Code */}
              <col className="w-[6rem]" /> {/* Type */}
              <col className="w-[7rem]" /> {/* HSN */}
              <col className="w-[8rem]" /> {/* Group */}
              <col className="w-[4rem]" /> {/* Tax */}
              <col className="w-[7rem]" /> {/* Status */}
              <col className="w-[5rem]" /> {/* Actions */}
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                {[
                  "Item Code",
                  "Description",
                  "Short Code",
                  "Type",
                  "HSN",
                  "Group",
                  "Tax",
                  "Status",
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
                    colSpan={9}
                    className="px-4 py-8 text-center text-muted-foreground text-sm"
                  >
                    {search ? "No items match your search." : "No items yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row._id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {row.itemCode}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[180px] truncate">
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
                      {ITEM_GROUPS.find((g) => g.code === row.belongsTo)
                        ?.description ?? row.belongsTo}
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
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.discontinue === "active" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}
                      >
                        {row.discontinue === "active"
                          ? "Active"
                          : "Discontinued"}
                      </span>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default ItemMaster;
