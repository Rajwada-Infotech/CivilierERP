import React, { useState, useCallback, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface ItemGroup {
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
  belongsTo: string;
  discontinue: "active" | "discontinued";
}

// ── HSN Codes (construction / ERP relevant) ───────────────────────────────────
const HSN_CODES: { code: string; description: string }[] = [
  // Building Materials
  {
    code: "2523",
    description: "Portland cement, aluminous cement, slag cement",
  },
  {
    code: "2515",
    description: "Marble, travertine and other calcareous stone",
  },
  { code: "2516", description: "Granite, porphyry, basalt, sandstone" },
  { code: "2517", description: "Pebbles, gravel, broken or crushed stone" },
  { code: "2505", description: "Natural sands of all kinds" },
  { code: "2520", description: "Gypsum; anhydrite; plasters" },
  { code: "2522", description: "Quicklime, slaked lime and hydraulic lime" },
  {
    code: "6810",
    description: "Articles of cement, concrete or artificial stone",
  },
  { code: "6904", description: "Ceramic building bricks, flooring blocks" },
  {
    code: "6907",
    description: "Ceramic flags, paving, hearth or wall tiles (unglazed)",
  },
  {
    code: "6908",
    description: "Glazed ceramic flags, paving, hearth or wall tiles",
  },
  { code: "6802", description: "Worked monumental or building stone" },
  { code: "7007", description: "Safety glass (toughened or laminated)" },
  {
    code: "7005",
    description: "Float glass and surface ground or polished glass",
  },
  {
    code: "7016",
    description: "Paving blocks, slabs, bricks of pressed glass",
  },
  // Steel & Metals
  {
    code: "7213",
    description: "Steel bars and rods, hot-rolled in coils (TMT bars)",
  },
  {
    code: "7214",
    description: "Other bars and rods of iron or non-alloy steel",
  },
  { code: "7216", description: "Angles, shapes and sections of iron or steel" },
  { code: "7217", description: "Wire of iron or non-alloy steel" },
  {
    code: "7208",
    description: "Flat-rolled steel products, width ≥ 600mm (HR coils/sheets)",
  },
  {
    code: "7210",
    description: "Flat-rolled steel, plated or coated with zinc (GI sheets)",
  },
  {
    code: "7304",
    description: "Seamless tubes, pipes and hollow profiles of iron or steel",
  },
  {
    code: "7305",
    description: "Other tubes and pipes (line pipe for oil/gas)",
  },
  {
    code: "7306",
    description: "Other tubes, pipes and hollow profiles of iron or steel",
  },
  { code: "7307", description: "Tube or pipe fittings of iron or steel" },
  {
    code: "7308",
    description: "Structures and parts of structures of iron or steel",
  },
  {
    code: "7312",
    description: "Stranded wire, ropes, cables, slings of iron or steel",
  },
  {
    code: "7317",
    description: "Nails, tacks, drawing pins, staples of iron or steel",
  },
  { code: "7318", description: "Screws, bolts, nuts of iron or steel" },
  { code: "7326", description: "Other articles of iron or steel" },
  { code: "7601", description: "Unwrought aluminium" },
  { code: "7610", description: "Aluminium structures and parts of structures" },
  { code: "7604", description: "Aluminium bars, rods and profiles" },
  { code: "7608", description: "Aluminium tubes and pipes" },
  // Electrical
  {
    code: "8544",
    description:
      "Insulated wire, cable and other insulated electric conductors",
  },
  {
    code: "8536",
    description:
      "Electrical apparatus for switching or protecting circuits (≤1000V)",
  },
  {
    code: "8537",
    description:
      "Boards, panels, consoles for electric control or distribution",
  },
  {
    code: "8535",
    description:
      "Electrical apparatus for switching or protecting circuits (>1000V)",
  },
  {
    code: "8539",
    description: "Electric filament or discharge lamps, LED lamps",
  },
  {
    code: "9405",
    description:
      "Lamps and lighting fittings including searchlights and spotlights",
  },
  { code: "8501", description: "Electric motors and generators" },
  {
    code: "8504",
    description: "Electrical transformers, static converters and inductors",
  },
  { code: "8507", description: "Electric accumulators (batteries)" },
  {
    code: "8541",
    description: "Semiconductor devices; photovoltaic cells (solar panels)",
  },
  // Plumbing & Sanitary
  { code: "3917", description: "Tubes, pipes and hoses of plastics" },
  {
    code: "3922",
    description: "Baths, shower-baths, sinks, wash-basins of plastics",
  },
  {
    code: "6910",
    description: "Ceramic sinks, wash basins, baths and sanitary fixtures",
  },
  {
    code: "7324",
    description: "Sanitary ware and parts thereof of iron or steel",
  },
  { code: "8481", description: "Taps, cocks, valves and similar appliances" },
  { code: "7412", description: "Copper tube or pipe fittings" },
  { code: "7411", description: "Copper tubes and pipes" },
  // Paints, Adhesives & Chemicals
  {
    code: "3208",
    description: "Paints and varnishes (including enamels and lacquers)",
  },
  {
    code: "3209",
    description: "Paints and varnishes based on acrylic or vinyl polymers",
  },
  {
    code: "3214",
    description: "Glaziers putty, grafting putty, caulking compounds, sealants",
  },
  { code: "3506", description: "Prepared glues and other prepared adhesives" },
  {
    code: "3816",
    description:
      "Refractory cements, mortars, concretes and similar compositions",
  },
  { code: "3814", description: "Organic composite solvents and thinners" },
  {
    code: "3824",
    description:
      "Prepared binders for foundry moulds or cores; chemical products",
  },
  // Wood & Board
  {
    code: "4412",
    description: "Plywood, veneered panels and similar laminated wood",
  },
  { code: "4410", description: "Particle board, oriented strand board (OSB)" },
  {
    code: "4411",
    description: "Fibre board (MDF) of wood or other ligneous materials",
  },
  {
    code: "4418",
    description:
      "Builders joinery and carpentry of wood (doors, windows, frames)",
  },
  { code: "4407", description: "Wood sawn or chipped lengthwise (timber)" },
  // Machinery & Equipment
  {
    code: "8429",
    description: "Self-propelled bulldozers, graders, scrapers, excavators",
  },
  {
    code: "8430",
    description: "Other moving, grading, levelling, excavating machinery",
  },
  {
    code: "8426",
    description:
      "Cranes including cable cranes; mobile lifting frames, stacker",
  },
  {
    code: "8427",
    description: "Fork-lift trucks; other works trucks with lifting equipment",
  },
  {
    code: "8428",
    description: "Other lifting, handling, loading or unloading machinery",
  },
  { code: "8413", description: "Pumps for liquids" },
  {
    code: "8414",
    description: "Air or vacuum pumps, air compressors and fans",
  },
  { code: "8415", description: "Air conditioning machines" },
  {
    code: "8467",
    description:
      "Hand tools, pneumatic, hydraulic or with self-contained motor",
  },
  {
    code: "8474",
    description: "Machinery for sorting, screening, crushing stone or ores",
  },
  { code: "8482", description: "Ball or roller bearings" },
  {
    code: "8483",
    description: "Transmission shafts, cranks, bearing housings",
  },
  // Vehicles & Transport
  {
    code: "8704",
    description: "Motor vehicles for the transport of goods (trucks/tippers)",
  },
  {
    code: "8705",
    description:
      "Special purpose motor vehicles (mobile cranes, concrete mixers)",
  },
  { code: "8701", description: "Tractors" },
  { code: "8716", description: "Trailers and semi-trailers" },
  // Safety & PPE
  { code: "6506", description: "Other headgear (safety helmets)" },
  {
    code: "6403",
    description: "Safety footwear with outer soles of rubber or plastics",
  },
  {
    code: "3926",
    description: "Other articles of plastics (safety goggles, hard hats)",
  },
  { code: "6216", description: "Gloves, mittens and mitts (safety gloves)" },
  // Services
  { code: "9954", description: "Construction services" },
  {
    code: "9983",
    description: "Other professional, technical and business services",
  },
  {
    code: "9987",
    description: "Maintenance, repair and installation services",
  },
  {
    code: "9985",
    description: "Support services (security, cleaning, pest control)",
  },
  {
    code: "9986",
    description: "Agriculture, forestry and fishing related services",
  },
  { code: "9973", description: "Leasing or rental services without operator" },
  { code: "9997", description: "Other services not elsewhere classified" },
];

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
    hsnCode: "2523",
    showTaxCalculated: true,
    belongsTo: "RM",
    discontinue: "active",
  },
  {
    _id: "seed-2",
    description: "Steel TMT Bar 12mm",
    itemCode: "ITM0002",
    shortCode: "STL",
    itemType: "Goods",
    hsnCode: "7213",
    showTaxCalculated: true,
    belongsTo: "RM",
    discontinue: "active",
  },
  {
    _id: "seed-3",
    description: "Site Survey Service",
    itemCode: "ITM0003",
    shortCode: "SVY",
    itemType: "Service",
    hsnCode: "9983",
    showTaxCalculated: false,
    belongsTo: "SVC",
    discontinue: "active",
  },
  {
    _id: "seed-4",
    description: "JCB Rental Service",
    itemCode: "ITM0004",
    shortCode: "JCB",
    itemType: "Service",
    hsnCode: "9987",
    showTaxCalculated: false,
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
  belongsTo: "",
  discontinue: "active",
};

// ── Searchable HSN Dropdown ───────────────────────────────────────────────────
const HsnDropdown: React.FC<{
  value: string;
  onChange: (code: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = HSN_CODES.find((h) => h.code === value);

  const filtered = query.trim()
    ? HSN_CODES.filter(
        (h) =>
          h.code.includes(query) ||
          h.description.toLowerCase().includes(query.toLowerCase()),
      )
    : HSN_CODES;

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
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-primary shrink-0">
              {selected.code}
            </span>
            <span className="text-muted-foreground truncate">
              {selected.description}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select HSN code...</span>
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
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                No HSN codes found
              </div>
            ) : (
              filtered.map((h) => (
                <button
                  key={h.code}
                  type="button"
                  onClick={() => handleSelect(h.code)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${h.code === value ? "bg-primary/10" : ""}`}
                >
                  <span className="font-mono text-primary shrink-0 w-12">
                    {h.code}
                  </span>
                  <span className="text-muted-foreground text-xs truncate">
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
      setForm((p) => ({ ...p, [key]: val }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors],
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
    <AppLayout>
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

          {/* HSN Code — searchable dropdown */}
          <Field label="HSN Code">
            <HsnDropdown
              value={form.hsnCode}
              onChange={(val) => set("hsnCode", val)}
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
          <div className="flex items-center gap-3 pt-5">
            <button
              type="button"
              onClick={() => set("showTaxCalculated", !form.showTaxCalculated)}
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
          <table className="w-full text-sm">
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
                    <td className="px-4 py-3">
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
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.showTaxCalculated ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                      >
                        {row.showTaxCalculated ? "Yes" : "No"}
                      </span>
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
    </AppLayout>
  );
};

export default ItemMaster;
