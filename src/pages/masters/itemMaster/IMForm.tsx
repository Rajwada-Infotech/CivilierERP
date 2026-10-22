import { Check, Loader2, RotateCcw, Save, Plus, Ruler } from "lucide-react";
import { AlternateUomTagger } from "../ItemUomAlternatesEditor";
import { GLAccountSelect } from "@/components/finance/GLAccountSelect";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Item, HsnDropdown, Field, inputCls } from "./config";
import type { ItemMasterState } from "./useItemMaster";

// Adding or editing an item: identity, group and units, HSN and tax rates, accounts, suppliers.
export function IMForm({ m }: { m: ItemMasterState }) {
  const { rights, itemGroups, uomOptions, hsnCodes, codesFor, supplierOptions, costCenterOptions, form, editingId, errors, saving, alternateUoms, setAlternateUoms, showAlternateUoms, setShowAlternateUoms, loadingAlternateUoms, set, handleSave, handleReset, error } = m;
  return (
    <>
      {/* ── Form ── */}
      {/* Shown to add (create rights) or to edit an item opened from the list (edit rights). */}
      {(rights.canCreate || (rights.canEdit && editingId)) && (
      <div className="border border-foreground bg-card p-6 mb-6">
        <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground mb-4">
          {editingId ? "Edit Item" : "Add Item"}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
          <Field
            label="Item Group (Parent)"
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
          {/* UOM */}
          <Field label="Unit of Measure (UOM)">
            <div className="flex items-center gap-2">
              <select
                value={form.uomCode}
                onChange={(e) => set("uomCode", e.target.value)}
                className={`${inputCls()} flex-1`}
              >
                <option value="">Select UOM...</option>
                {uomOptions.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAlternateUoms((v) => !v)}
                disabled={!form.uomCode}
                title={
                  form.uomCode
                    ? "Tag alternate UOMs for this item"
                    : "Select this item's own UOM first"
                }
                className={`shrink-0 w-9 h-9 flex items-center justify-center border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  showAlternateUoms
                    ? "bg-foreground text-card border border-foreground border-primary"
                    : "border-foreground/30 text-muted-foreground hover:text-foreground hover:bg-primary/5"
                }`}
              >
                {alternateUoms.length > 0 && !showAlternateUoms ? (
                  <span className="text-[0.625rem] font-bold">
                    {alternateUoms.length}
                  </span>
                ) : (
                  <Plus size={14} />
                )}
              </button>
            </div>
          </Field>

          {/* Alternate UOMs — inline, tagged before the item is even
              saved. Spans the full row so it isn't cramped next to the
              other 3-column fields. */}
          {showAlternateUoms && form.uomCode && (
            <div className="sm:col-span-2 lg:col-span-3 border border-foreground/30 bg-card p-4">
              <p className="text-xs font-heading font-semibold text-foreground flex items-center gap-1.5 mb-1">
                <Ruler size={13} className="text-primary" />
                Alternate UOMs
              </p>
              <p className="text-[0.6875rem] text-muted-foreground mb-3">
                Tag other units this item can also be requested/ordered in,
                with how many{" "}
                <span className="font-heading">
                  {uomOptions.find((u) => u.value === form.uomCode)?.label ||
                    form.uomCode}
                </span>{" "}
                (this item's own UOM) one unit of the alternate equals —
                e.g. Cement base Bag, tag CFT with factor 0.3 for 1 CFT =
                0.3 Bag.
              </p>
              {loadingAlternateUoms ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : (
                <AlternateUomTagger
                  rows={alternateUoms}
                  onChange={setAlternateUoms}
                  baseUomCode={form.uomCode}
                  uomOptions={uomOptions}
                />
              )}
            </div>
          )}
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
              <option value="Fixed Asset">Fixed Asset</option>
            </select>
          </Field>
          {/* HSN Code (Goods / Fixed Asset) or SAC Code (Service) */}
          <Field label={form.itemType === "Service" ? "SAC Code" : "HSN Code"}>
            <HsnDropdown
              value={form.hsnCode}
              onChange={(val) => set("hsnCode", val)}
              hsnCodes={codesFor(form.itemType)}
              label={form.itemType === "Service" ? "SAC" : "HSN"}
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
          {/* Default Supplier */}
          <Field label="Default Supplier">
            <SearchableNativeSelect
              value={form.defaultSupplierId}
              onChange={(e) => set("defaultSupplierId", e.target.value)}
              className={inputCls()}
            >
              <option value="">— No default supplier —</option>
              {supplierOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SearchableNativeSelect>
          </Field>
          {/* GL Account tag — the account this item's spend is booked under */}
          <Field label="GL Account">
            <GLAccountSelect
              value={form.glHeadId ? parseInt(form.glHeadId, 10) : null}
              onChange={(id) => set("glHeadId", id ? String(id) : "")}
              placeholder="— No GL account tag —"
            />
          </Field>
          {/* Cost Centre tag — auto-fills the Cost Centre when this item is
              added to a Purchase Order (see PurchaseOrderMaster.tsx). */}
          <Field label="Cost Centre">
            <select
              value={form.costCenterId}
              onChange={(e) => set("costCenterId", e.target.value)}
              className={inputCls()}
            >
              <option value="">— No cost centre tag —</option>
              {costCenterOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          {/* Days of Supply — numeric field */}
          <Field label="Days of Supply">
            <input
              type="number"
              min={0}
              step={1}
              value={form.daysOfSupply}
              onChange={(e) => set("daysOfSupply", e.target.value)}
              className={inputCls()}
              placeholder="e.g. 30"
            />
          </Field>
        </div>

        {/* ── Tax Rates ── */}
        <div className="mt-4">
          <p className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Tax Rates{" "}
            {form.hsnCode && (
              <span className="normal-case text-primary font-normal">
                (auto-filled from HSN)
              </span>
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
                  onChange={(e) =>
                    set("cgst", parseFloat(e.target.value) || 0)
                  }
                  placeholder="0"
                  className={`${inputCls()} pr-8`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
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
                  onChange={(e) =>
                    set("sgst", parseFloat(e.target.value) || 0)
                  }
                  placeholder="0"
                  className={`${inputCls()} pr-8`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
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
                  onChange={(e) =>
                    set("igst", parseFloat(e.target.value) || 0)
                  }
                  placeholder="0"
                  className={`${inputCls()} pr-8`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  %
                </span>
              </div>
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-foreground/30 bg-card overflow-hidden mt-2">
          <p className="hidden sm:block text-[0.6875rem] text-muted-foreground">
            Ready to save
          </p>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              onClick={handleReset}
              className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-heading border border-foreground/30 text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 sm:flex-none px-5 py-2 text-sm font-heading font-semibold bg-foreground text-card border border-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
            >
              {saving ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
              ) : editingId ? (
                <Check size={14} />
              ) : (
                <Save size={14} />
              )}
              {saving ? "Saving…" : editingId ? "Update Item" : "Save Item"}
            </button>
          </div>
        </div>
      </div>
      )}
    </>
  );
}
