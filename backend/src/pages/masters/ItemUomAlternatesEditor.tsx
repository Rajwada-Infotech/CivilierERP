import React from "react";
import { Plus, Trash2 } from "lucide-react";

export interface UomOption {
  value: string;
  label: string;
}

export interface AlternateUomRow {
  uomCode: string;
  conversionFactor: string;
}

/**
 * Controlled tag-list for an item's alternate UOMs — e.g. Cement's base UOM
 * is Bag, tag CFT with factor 0.3 to mean 1 CFT = 0.3 Bag. Material Request
 * and Purchase Order both read this to offer the tagged UOMs and
 * live-convert qty/rate when a line switches between them.
 *
 * Purely local state, no fetch/save of its own — the parent form owns the
 * rows (so they can be entered while creating a brand-new item, before an
 * itemId exists to key a saved row against) and persists them alongside
 * the item itself on submit.
 */
export function AlternateUomTagger({
  rows,
  onChange,
  baseUomCode,
  uomOptions,
}: {
  rows: AlternateUomRow[];
  onChange: (rows: AlternateUomRow[]) => void;
  baseUomCode: string;
  uomOptions: UomOption[];
}) {
  const availableToAdd = uomOptions.filter(
    (u) => u.value !== baseUomCode && !rows.some((r) => r.uomCode === u.value),
  );

  const addRow = () => {
    const next = availableToAdd[0];
    if (!next) return;
    onChange([...rows, { uomCode: next.value, conversionFactor: "1" }]);
  };

  const updateRow = (idx: number, field: keyof AlternateUomRow, value: string) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  const baseLabel =
    uomOptions.find((u) => u.value === baseUomCode)?.label || baseUomCode;

  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const options = uomOptions.filter(
          (u) => u.value === r.uomCode || !rows.some((x) => x.uomCode === u.value),
        );
        return (
          <div key={idx} className="flex items-center gap-2">
            <select
              value={r.uomCode}
              onChange={(e) => updateRow(idx, "uomCode", e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {options
                .filter((u) => u.value !== baseUomCode)
                .map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
            </select>
            <span className="text-[11px] text-muted-foreground shrink-0">
              1 unit =
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={r.conversionFactor}
              onChange={(e) => updateRow(idx, "conversionFactor", e.target.value)}
              className="w-24 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="0.3"
            />
            <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
              {baseLabel}
            </span>
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="p-1 rounded hover:bg-destructive/10 text-destructive shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        disabled={availableToAdd.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-heading border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus size={12} /> Add alternate UOM
      </button>
    </div>
  );
}
