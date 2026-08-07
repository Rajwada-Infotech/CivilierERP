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
import { createPortal } from "react-dom";
import { Plus, Trash2, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "./PickerPrimitives";
import { fmt } from "./helpers";
import { getItems, type DbItem } from "@/api/itemMasterApi";

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

// Themed replacement for a native <input list="..."> datalist — that
// renders as the browser's own unstyled OS popup (black box, system font),
// which clashed hard with the app's dark UI. This is a typeable, portalled
// dropdown matching the same pattern the rest of the app uses for
// searchable pickers (see payment/components/FilterBar.tsx's VendorCombo).
function ItemDescriptionCombo({
  value,
  onSelect,
  onChange,
  items,
  loading,
  readOnly,
}: {
  value: string;
  onSelect: (item: DbItem) => void;
  onChange: (val: string) => void;
  items: DbItem[];
  loading: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  };

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const q = value.trim().toLowerCase();
  const filtered = q ? items.filter((it) => it.M_Name.toLowerCase().includes(q)) : items;

  const panel = open && rect && !readOnly && createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220), zIndex: 9999 }}
      className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="max-h-56 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Loading service items…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {items.length === 0 ? "No service items in Item Master." : "No matches — this will be saved as free text."}
          </p>
        ) : (
          filtered.map((it) => (
            <button
              key={it.M_Id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(it); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors truncate text-foreground"
            >
              {it.M_Name}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
      <Input
        ref={inputRef}
        value={value}
        readOnly={readOnly}
        onFocus={() => setOpen(true)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loading ? "Loading service items…" : "Item description…"}
        className="h-8 text-xs border-border/60 bg-transparent pl-6 pr-2"
      />
      {panel}
    </div>
  );
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

  // Item picker — DINV/Other Expenses is a service-driven booking (no
  // goods, since goods always flow through a GRN first), so only Item
  // Master rows tagged M_Type='Service' are offered here. Posting these
  // against GL/cost-center per item is a follow-up, not wired yet.
  const [serviceItems, setServiceItems] = useState<DbItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    setItemsLoading(true);
    getItems()
      .then((rows) => setServiceItems(rows.filter((it) => it.M_Type === "Service")))
      .catch(() => setServiceItems([]))
      .finally(() => setItemsLoading(false));
  }, []);

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
                {/* Description — suggestions limited to Item Master's
                    Service-type items, typed free text still allowed for
                    ad-hoc entries not in the master. */}
                <ItemDescriptionCombo
                  value={item.description}
                  readOnly={readOnly}
                  loading={itemsLoading}
                  items={serviceItems}
                  onChange={(val) => patch(i, { description: val })}
                  onSelect={(it) => {
                    patch(i, {
                      description: it.M_Name,
                      ...(it.M_UOM ? { uom: it.M_UOM } : {}),
                    });
                    if (it.M_UOM) lastUom.current = it.M_UOM;
                  }}
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
