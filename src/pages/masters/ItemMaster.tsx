import React, { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit2, Trash2, Check, X, RefreshCw } from "lucide-react";
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

// ── Static item groups (in real app would come from ItemGroupMaster context) ──
const ITEM_GROUPS: ItemGroup[] = [
  { code: "RM",  description: "Raw Materials" },
  { code: "FG",  description: "Finished Goods" },
  { code: "SVC", description: "Services" },
  { code: "CG",  description: "Capital Goods" },
];

// ── Auto-generate item code ────────────────────────────────────────────────
let _itemCounter = 4;
function generateItemCode(): string {
  _itemCounter += 1;
  return `ITM${String(_itemCounter).padStart(4, "0")}`;
}

const INITIAL_DATA: Item[] = [
  { _id: "seed-1", description: "Cement OPC 53 Grade", itemCode: "ITM0001", shortCode: "CEM", itemType: "Goods",   hsnCode: "2523", showTaxCalculated: true,  belongsTo: "RM",  discontinue: "active" },
  { _id: "seed-2", description: "Steel TMT Bar 12mm",  itemCode: "ITM0002", shortCode: "STL", itemType: "Goods",   hsnCode: "7213", showTaxCalculated: true,  belongsTo: "RM",  discontinue: "active" },
  { _id: "seed-3", description: "Site Survey Service",  itemCode: "ITM0003", shortCode: "SVY", itemType: "Service", hsnCode: "9983", showTaxCalculated: false, belongsTo: "SVC", discontinue: "active" },
  { _id: "seed-4", description: "JCB Rental Service",   itemCode: "ITM0004", shortCode: "JCB", itemType: "Service", hsnCode: "9987", showTaxCalculated: false, belongsTo: "SVC", discontinue: "discontinued" },
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

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({ label, required, error, children }: { label: string; required?: boolean; error?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="block text-xs font-heading text-muted-foreground mb-1">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && <p className="text-xs text-destructive mt-1">{label} is required</p>}
  </div>
);

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${err ? "border-destructive" : "border-border"}`;

// ── Main Component ────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
  const [data, setData]           = useState<Item[]>(INITIAL_DATA);
  const [form, setForm]           = useState<Omit<Item, "_id">>({ ...EMPTY_FORM, itemCode: generateItemCode() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors]       = useState<Record<string, boolean>>({});
  const [search, setSearch]       = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const set = useCallback((key: keyof Omit<Item, "_id">, val: unknown) => {
    setForm(p => ({ ...p, [key]: val }));
    if (errors[key]) setErrors(p => ({ ...p, [key]: false }));
  }, [errors]);

  const regenerateCode = () => set("itemCode", generateItemCode());

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.description.trim()) errs.description = true;
    if (!form.shortCode.trim())   errs.shortCode   = true;
    if (!form.itemType)           errs.itemType     = true;
    if (!form.belongsTo)          errs.belongsTo    = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (editingId) {
      setData(prev => prev.map(r => r._id === editingId ? { ...form, _id: editingId } : r));
      setEditingId(null);
      toast.success("Item updated successfully ✓");
    } else {
      setData(prev => [...prev, { ...form, _id: `item-${Date.now()}` }]);
      toast.success("Item saved successfully ✓");
    }
    setForm({ ...EMPTY_FORM, itemCode: generateItemCode() });
  };

  const handleEdit = (id: string) => {
    const row = data.find(r => r._id === id);
    if (!row) return;
    const { _id, ...rest } = row;
    setForm(rest);
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    if (editingId === id) { setEditingId(null); setForm({ ...EMPTY_FORM, itemCode: generateItemCode() }); }
    setData(prev => prev.filter(r => r._id !== id));
    setDeleteConfirmId(null);
    toast.success("Item deleted");
  };

  const handleReset = () => {
    setForm({ ...EMPTY_FORM, itemCode: generateItemCode() });
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter(r =>
    !search || Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Item Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Item Master</h1>

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
              onChange={e => set("description", e.target.value)}
              className={inputCls(errors.description)}
              placeholder="Item description"
            />
          </Field>

          {/* Item Code — auto generated */}
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
              onChange={e => set("shortCode", e.target.value.toUpperCase())}
              className={inputCls(errors.shortCode)}
              placeholder="e.g. CEM"
              maxLength={6}
            />
          </Field>

          {/* Type of Item */}
          <Field label="Type of Item" required error={errors.itemType}>
            <select
              value={form.itemType}
              onChange={e => set("itemType", e.target.value)}
              className={inputCls(errors.itemType)}
            >
              <option value="">Select type...</option>
              <option value="Service">Service</option>
              <option value="Goods">Goods</option>
            </select>
          </Field>

          {/* HSN Code */}
          <Field label="HSN Code">
            <input
              type="text"
              value={form.hsnCode}
              onChange={e => set("hsnCode", e.target.value)}
              className={inputCls()}
              placeholder="e.g. 2523 — HSN code list coming soon"
            />
          </Field>

          {/* Belongs To (Item Group) */}
          <Field label="Belongs To (Item Group)" required error={errors.belongsTo}>
            <select
              value={form.belongsTo}
              onChange={e => set("belongsTo", e.target.value)}
              className={inputCls(errors.belongsTo)}
            >
              <option value="">Select group...</option>
              {ITEM_GROUPS.map(g => (
                <option key={g.code} value={g.code}>{g.description}</option>
              ))}
            </select>
          </Field>

          {/* Show Tax Calculated — toggle */}
          <div className="flex items-center gap-3 pt-5">
            <button
              type="button"
              onClick={() => set("showTaxCalculated", !form.showTaxCalculated)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.showTaxCalculated ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform ${form.showTaxCalculated ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className="text-sm font-heading text-foreground">Show Tax Calculated</span>
          </div>

          {/* Discontinue — radio buttons */}
          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-2">Status</label>
            <div className="flex items-center gap-6">
              {(["active", "discontinued"] as const).map(val => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
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
          <button onClick={handleSave} className="px-5 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all">
            {editingId ? "Update" : "Save"}
          </button>
          <button onClick={handleReset} className="px-5 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all">
            Reset
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Item Code","Description","Short Code","Type","HSN","Group","Tax","Status",""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-heading uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">{search ? "No items match your search." : "No items yet."}</td></tr>
              ) : filtered.map(row => (
                <tr key={row._id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.itemCode}</td>
                  <td className="px-4 py-3 text-foreground max-w-[180px] truncate">{row.description}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.shortCode}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.itemType === "Service" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}>
                      {row.itemType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.hsnCode || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{ITEM_GROUPS.find(g => g.code === row.belongsTo)?.description ?? row.belongsTo}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.showTaxCalculated ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {row.showTaxCalculated ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row.discontinue === "active" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                      {row.discontinue === "active" ? "Active" : "Discontinued"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {deleteConfirmId === row._id ? (
                        <>
                          <button onClick={() => handleDelete(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={14} /></button>
                          <button onClick={() => setDeleteConfirmId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleEdit(row._id)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"><Edit2 size={14} /></button>
                          <button onClick={() => setDeleteConfirmId(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
};

export default ItemMaster;
