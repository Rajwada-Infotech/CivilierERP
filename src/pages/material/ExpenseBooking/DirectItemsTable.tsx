/**
 * src/pages/material/ExpenseBooking/DirectItemsTable.tsx
 *
 * Line-item editor shown ONLY for "Other Expenses" (TOD / direct) bookings —
 * i.e. when no PO, WO, GRN or Work Done doc is linked.
 *
 * Each item has:
 *   description  – free-text (what was purchased / what service was rendered)
 *   qty          – quantity (positive decimal)
 *   uom          – unit of measurement, auto-populated from the last used UOM
 *                  and selectable from the full UOM master list
 *   rate         – unit rate in Rs.
 *   amount       – computed read-only: qty x rate
 *
 * The parent receives the updated items array and the recomputed total via
 * onChange and onTotalChange.  The parent is responsible for writing the
 * total into form.basicAmount so the existing AmountGstSection continues
 * to work unchanged.
 *
 * This file is intentionally standalone — it has no side-effects on the rest
 * of the form and can be unit-tested in isolation.
 */

import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "./PickerPrimitives";
import { fmt } from "./helpers";

// Types

export interface DirectLineItem {
  /** Stable local key for React rendering (never persisted). */
  _key: string;
  description: string;
  qty: number;
  uom: string;
  rate: number;
  /** Computed: qty x rate. */
  amount: number;
}

interface UomOption {
  id: number;
  name: string;
  abbreviation: string;
}

// Pure helpers (exported for use in helpers.ts / tests)

function makeKey() {
  return `di-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankItem(defaultUom: string): DirectLineItem {
  return { _key: makeKey(), description: "", qty: 1, uom: defaultUom, rate: 0, amount: 0 };
}

export function computeItemAmount(qty: number, rate: number): number {
  return Math.round(qty * rate * 100) / 100;
}

export function computeDirectTotal(items: DirectLineItem[]): number {
  return Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
}

/** Build a fresh DirectLineItem from plain data (e.g. when loading from DB). */
export function makeDirectLineItem(data: Partial<DirectLineItem>): DirectLineItem {
  const qty = Number(data.qty) || 0;
  const rate = Number(data.rate) || 0;
  return {
    _key: data._key || makeKey(),
    description: data.description || "",
    qty,
    uom: data.uom || "",
    rate,
    amount: computeItemAmount(qty, rate),
  };
}

// Component

interface DirectItemsTableProps {
  items: DirectLineItem[];
  /** Called whenever the items array changes (add / edit / delete). */
  onChange: (items: DirectLineItem[]) => void;
  /** Called with the recomputed sum of all line amounts after any change. */
  onTotalChange: (total: number) => void;
  /** Whether the form is locked (Approved / Pending). */
  readOnly?: boolean;
}

export function DirectItemsTable({ items, onChange, onTotalChange, readOnly = false }: DirectItemsTableProps) {
  const [uomOptions, setUomOptions] = useState<UomOption[]>([]);
  const [uomLoading, setUomLoading] = useState(false);
  const lastUom = useRef<string>("");

  useEffect(() => {
    setUomLoading(true);
    fetch("/api/unit-of-measurement", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
    })
      .then((r) => r.json())
      .then((data: any[]) => {
        const opts: UomOption[] = Array.isArray(data)
          ? data.map((u) => ({
              id: u.UomId ?? u.id,
              name: u.UomName ?? u.name ?? "",
              abbreviation: u.UomAbbreviation ?? u.abbreviation ?? "",
            }))
          : [];
        setUomOptions(opts);
        if (opts.length > 0 && !lastUom.current) {
          lastUom.current = opts[0].abbreviation || opts[0].name;
        }
      })
      .catch(() => {})
      .finally(() => setUomLoading(false));
  }, []);

  function patch(index: number, delta: Partial<DirectLineItem>) {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      const merged = { ...item, ...delta };
      merged.amount = computeItemAmount(merged.qty, merged.rate);
      return merged;
    });
    onChange(next);
    onTotalChange(computeDirectTotal(next));
  }

  function addItem() {
    const uom = lastUom.current || (uomOptions[0]?.abbreviation ?? "");
    const next = [...items, blankItem(uom)];
    onChange(next);
    onTotalChange(computeDirectTotal(next));
  }

  function removeItem(index: number) {
    const next = items.filter((_, i) => i !== index);
    onChange(next);
    onTotalChange(computeDirectTotal(next));
  }

  const total = computeDirectTotal(items);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader label="Invoice Items" />
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
            className="h-7 px-2.5 text-xs gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
          >
            <Plus size={12} />
            Add Item
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 rounded-xl border border-dashed border-border/50 text-center">
          <Package size={22} className="text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            No items yet.{" "}
            {!readOnly && (
              <button
                type="button"
                onClick={addItem}
                className="underline text-emerald-500 hover:text-emerald-400"
              >
                Add the first item
              </button>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_72px_96px_84px_88px_28px] text-[10px] uppercase tracking-widest font-semibold text-muted-foreground px-3 py-2 bg-muted/30 border-b border-border gap-1">
            <span>Description</span>
            <span className="text-center">Qty</span>
            <span className="text-center">UOM</span>
            <span className="text-right">Rate (Rs.)</span>
            <span className="text-right">Amount (Rs.)</span>
            <span />
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {items.map((item, i) => (
              <div
                key={item._key}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_72px_96px_84px_88px_28px] gap-1.5 items-center px-2 py-2 bg-background hover:bg-muted/5 transition-colors"
              >
                {/* Description */}
                <Input
                  value={item.description}
                  readOnly={readOnly}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="Item description…"
                  className="h-8 text-xs border-border/60 bg-transparent px-2"
                />

                {/* Qty */}
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={item.qty || ""}
                  readOnly={readOnly}
                  onChange={(e) => patch(i, { qty: parseFloat(e.target.value) || 0 })}
                  className="h-8 text-xs text-center border-border/60 bg-transparent px-1 font-mono w-[72px]"
                  placeholder="1"
                />

                {/* UOM */}
                {readOnly ? (
                  <span className="text-xs text-center text-muted-foreground font-mono px-1 w-[96px]">
                    {item.uom || "—"}
                  </span>
                ) : (
                  <select
                    value={item.uom}
                    disabled={uomLoading}
                    onChange={(e) => { lastUom.current = e.target.value; patch(i, { uom: e.target.value }); }}
                    className="h-8 text-xs rounded-md border border-border/60 bg-background text-foreground px-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 font-mono w-[96px]"
                  >
                    {item.uom && !uomOptions.some((u) => (u.abbreviation || u.name) === item.uom) && (
                      <option value={item.uom}>{item.uom}</option>
                    )}
                    {uomOptions.map((u) => {
                      const val = u.abbreviation || u.name;
                      const label = u.abbreviation && u.name && u.abbreviation !== u.name
                        ? `${u.abbreviation} — ${u.name}`
                        : val;
                      return <option key={u.id} value={val}>{label}</option>;
                    })}
                    {uomOptions.length === 0 && <option value={item.uom || "Nos"}>{item.uom || "Nos"}</option>}
                  </select>
                )}

                {/* Rate */}
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={item.rate || ""}
                  readOnly={readOnly}
                  onChange={(e) => patch(i, { rate: parseFloat(e.target.value) || 0 })}
                  className="h-8 text-xs text-right border-border/60 bg-transparent px-1 font-mono w-[84px]"
                  placeholder="0.00"
                />

                {/* Computed amount */}
                <span className="text-xs text-right font-mono font-semibold text-foreground pr-1 w-[88px]">
                  {item.amount > 0 ? `Rs.${fmt(item.amount)}` : "—"}
                </span>

                {/* Remove */}
                {readOnly ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="flex items-center justify-center h-7 w-7 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove item"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Footer total */}
          {items.length > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-t border-border">
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                Subtotal ({items.length} items)
              </span>
              <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                Rs.{fmt(total)}
              </span>
            </div>
          )}
        </div>
      )}

      {!readOnly && items.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Basic Amount is automatically calculated from the sum of all line items (qty x rate).
        </p>
      )}
    </div>
  );
}
