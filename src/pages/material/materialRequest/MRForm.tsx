import { ItemPicker } from "../ItemPicker";
import { CalendarDays, Save, Plus, X, Hash, ArrowLeft, RotateCcw, Check, ChevronDown } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { relevantUOMs, convertQuantity } from "@/lib/uomConversion";
import { alternatesForItem, getItemUomFactor, convertItemQuantity } from "@/lib/itemUomAlternates";
import { DateInput } from "@/components/ui/date-input";
import { inputCls, selectCls, blankCartItem, PRIORITY_OPTIONS, Field, HEAD, LBL, RULE, KEY_INK, KEY_LINE, ACT } from "./config";
import type { MRState } from "./useMaterialRequest";

// Create / edit a material request: header, items, save.
export function MRForm({ m }: { m: MRState }) {
  const { editingId, viewingRecord, header, setHeader, cart, setCart, woSource, setH, companies, filteredProjects, finYears, finYearStr, uoms, itemUomAlternates, mrDocTypes, mrDocTypesLoading, itemMap, availableSupplyDays, pickableItems, uomMap, maxDaysOfSupply, minRequiredByDate, updateCartItem, pickItem, addCartRow, removeCartRow, cartIsValid, canSave, isSaving, saved, goToList, resetFields, onSave } = m;
  return (
    <div className="space-y-5">
      {woSource && !editingId && (
        <div className="border-l-2 border-foreground pl-3 py-1 text-xs text-foreground/80">
          Raised from Work Order <strong>{woSource.docNo}</strong>. The items below are the work order's materials — change, add or remove anything, then save.
        </div>
      )}
      {/* Header card */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
          <button type="button" onClick={goToList} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
            <ArrowLeft size={12} /> Back
          </button>
          <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate">
            {editingId ? "Edit material request" : "New material request"}
          </h2>
        </div>

        <div className="p-4 space-y-4">
          {/* Doc number / Type of Doc */}
          <div className="flex flex-wrap items-center gap-3 border border-dashed border-foreground/50 px-4 py-3">
            <span className={`${LBL} mr-2 whitespace-nowrap`}>
              Request no
            </span>
            {editingId ? (
              <span className="font-heading font-bold tracking-wide text-foreground text-sm break-all">
                {viewingRecord?.DocNo ?? "Immutable after creation"}
              </span>
            ) : (
              <div className="flex-1 flex flex-wrap items-center gap-3 min-w-0">
                <div className="relative flex-1 min-w-[200px]">
                  <select
                    value={header.docTypeId ? String(header.docTypeId) : ""}
                    onChange={async (e) => {
                      const id = e.target.value
                        ? parseInt(e.target.value, 10)
                        : null;
                      if (!id) {
                        setHeader((p) => ({
                          ...p,
                          docTypeId: null,
                          docNoPreview: "",
                        }));
                        return;
                      }
                      const preview = await fetchNextDocNumber(id, finYearStr);
                      setHeader((p) => ({
                        ...p,
                        docTypeId: id,
                        docNoPreview: preview,
                      }));
                    }}
                    disabled={mrDocTypesLoading}
                    className={selectCls}
                  >
                    {mrDocTypesLoading ? (
                      <option value="">Loading…</option>
                    ) : mrDocTypes.length === 0 ? (
                      <option value="">No doc types found</option>
                    ) : (
                      mrDocTypes.map((dt) => {
                        const label =
                          dt.ProjectCode && dt.ModuleCode
                            ? `${dt.ProjectCode}-${dt.ModuleCode}`
                            : (dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix);
                        return (
                          <option
                            key={dt.TypeOfDocId}
                            value={String(dt.TypeOfDocId)}
                          >
                            {label} — {dt.Description}
                          </option>
                        );
                      })
                    )}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
                {header.docNoPreview && (
                  <span className="font-heading text-sm font-bold text-foreground tracking-wider whitespace-nowrap">
                    {header.docNoPreview}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Row 1: Company | Project | Fin Year | Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="Company" required>
              <div className="relative">
                <select
                  value={header.companyId}
                  onChange={(e) => {
                    setH("companyId", e.target.value);
                    setH("projectId", "");
                    setCart([blankCartItem()]);
                  }}
                  className={selectCls}
                >
                  <option value="">Select company</option>
                  {(companies as any[]).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.label ?? c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Project" required>
              <div className="relative">
                <select
                  value={header.projectId}
                  onChange={(e) => {
                    setH("projectId", e.target.value);
                    setCart([blankCartItem()]);
                  }}
                  className={selectCls}
                >
                  <option value="">Select project</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Financial Year">
              <div className="relative">
                <select
                  value={header.finYearId}
                  onChange={(e) => setH("finYearId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select fin year</option>
                  {(finYears as any[]).map((fy) => (
                    <option
                      key={fy.id}
                      value={String(fy.id)}
                      disabled={fy.isLocked}
                    >
                      {fy.name}
                      {fy.isLocked ? " (locked)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Priority">
              <div className="relative">
                <select
                  value={header.priority}
                  onChange={(e) => setH("priority", e.target.value)}
                  className={selectCls}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>
          </div>

          {/* Row 2: Request Date | Required By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Request Date" required>
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <DateInput
                  value={header.requestDate}
                  onChange={(e) => setH("requestDate", e.target.value)}
                  className={`${inputCls} pl-8`}
                />
              </div>
            </Field>
            <Field label="Required By Date">
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <DateInput
                  value={header.requiredByDate}
                  min={minRequiredByDate || undefined}
                  onChange={(e) => setH("requiredByDate", e.target.value)}
                  className={`${inputCls} pl-8`}
                />
              </div>
              {maxDaysOfSupply > 0 && (
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  Earliest possible: {minRequiredByDate} ({maxDaysOfSupply}-day supply lead time)
                </p>
              )}
            </Field>
          </div>

          {/* Row 3: Reason | Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Reason for Request" required>
              <textarea
                value={header.reason}
                onChange={(e) => setH("reason", e.target.value)}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="State the reason for this material request…"
              />
            </Field>
            <Field label="Remarks">
              <textarea
                value={header.remarks}
                onChange={(e) => setH("remarks", e.target.value)}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="Optional notes…"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <span className={HEAD}>
              Requested items <span className="font-normal text-muted-foreground tabular-nums ml-1">{cart.length}</span>
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              {header.projectId && <span>Stock shown is from the project's godown.</span>}
              {availableSupplyDays !== null && (
                <span className="ml-1">
                  Only items deliverable within {availableSupplyDays} day{availableSupplyDays === 1 ? "" : "s"} are listed.
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={addCartRow} className={`${KEY_LINE} h-8 px-3 self-start sm:self-auto`}>
            <Plus size={12} /> Add item
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Column headers — visible on md+ */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_auto] gap-3 pl-9 pr-1 pb-1">
            <span className={LBL}>Item</span>
            <span className={LBL}>Unit (UOM)</span>
            <span className={LBL}>Quantity</span>
            <span className="w-10" />
          </div>

          {cart.map((ci, idx) => (
            <div
              key={ci._key}
              className="relative flex border border-foreground/30 bg-card hover:border-foreground transition-colors"
            >
              {/* Row number */}
              <div className="w-8 shrink-0 flex items-start justify-center pt-4 border-r border-foreground/20 font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground">
                {String(idx + 1).padStart(2, "0")}
              </div>

              <div className="p-3 flex-1 min-w-0">
                {/* Main row: item | uom | qty | remove — all on one line on desktop */}
                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-start">
                  {/* Item selector */}
                  <div className="space-y-1.5">
                    <label className={`md:hidden ${LBL}`}>
                      Item *
                    </label>
                    <ItemPicker
                      items={pickableItems}
                      value={ci.ItemId}
                      onChange={(id) => pickItem(ci._key, id)}
                    />
                    {/* Surfaces where the Required By Date floor actually
                        comes from — without this, hitting the "can't be
                        earlier than X" validation looks like it's coming
                        from nowhere, since the min-date hint near the date
                        field itself is easy to miss/scroll past. */}
                    {Number(itemMap[ci.ItemId]?.DaysOfSupply ?? 0) > 0 && (
                      <p className="text-[0.625rem] text-muted-foreground">
                        {Number(itemMap[ci.ItemId].DaysOfSupply)}-day supply lead time
                      </p>
                    )}
                  </div>

                  {/* UOM selector */}
                  <div className="space-y-1.5">
                    <label className={`md:hidden ${LBL}`}>
                      Unit (UOM) *
                    </label>
                    <div className="relative">
                      {(() => {
                        const defaultCategory = ci.DefaultUOM
                          ? uomMap[ci.DefaultUOM]?.UOMCategory ?? null
                          : null;
                        // Only offer UOMs relevant to the item's own default
                        // unit (same measurement category, e.g. Weight units
                        // for a Weight item) — a water/liquid item no longer
                        // gets offered something like "Running Meter", and a
                        // packaging item (Box) only sees other packaging
                        // units (Pieces, Bags, ...) instead of the full list.
                        const relevant = relevantUOMs(
                          (uoms as any[]).map((u) => ({
                            ...u,
                            category: u.UOMCategory ?? null,
                          })),
                          defaultCategory,
                        ).filter((u: any) => u.UOMCode !== ci.DefaultUOM);

                        // Item-tagged alternates (e.g. Cement in CFT) have no
                        // fixed physical category, so they're never in the
                        // category-based `relevant` list above — merge them
                        // in separately, deduped against it.
                        const itemAlternates = ci.ItemId
                          ? alternatesForItem(itemUomAlternates, ci.ItemId)
                          : [];
                        const extraAlternates = itemAlternates
                          .filter(
                            (a) =>
                              a.uomCode !== ci.DefaultUOM &&
                              !relevant.some((u: any) => u.UOMCode === a.uomCode),
                          )
                          .map((a) => ({
                            UOMCode: a.uomCode,
                            UOMName: a.uomName || a.uomCode,
                            Symbol: a.symbol,
                          }));

                        return (
                          <select
                            value={ci.UOMCode}
                            onChange={(e) => {
                              const nextCode = e.target.value;
                              const nextUom = uomMap[nextCode];
                              const currentUom = uomMap[ci.UOMCode];

                              // Item-specific conversion (e.g. Cement Bag <->
                              // CFT) takes priority over the category-based
                              // one — it's the more precise, item-authored
                              // figure when both are available.
                              const itemFromFactor = ci.ItemId
                                ? getItemUomFactor(
                                    itemUomAlternates,
                                    ci.ItemId,
                                    ci.UOMCode,
                                    ci.DefaultUOM,
                                  )
                                : null;
                              const itemToFactor = ci.ItemId
                                ? getItemUomFactor(
                                    itemUomAlternates,
                                    ci.ItemId,
                                    nextCode,
                                    ci.DefaultUOM,
                                  )
                                : null;

                              let nextQty = ci.Quantity;
                              if (itemFromFactor != null && itemToFactor != null) {
                                nextQty = String(
                                  convertItemQuantity(
                                    parseFloat(ci.Quantity) || 0,
                                    itemFromFactor,
                                    itemToFactor,
                                  ),
                                );
                              } else if (
                                currentUom?.UOMCategory &&
                                nextUom?.UOMCategory === currentUom.UOMCategory &&
                                currentUom.BaseFactor &&
                                nextUom.BaseFactor
                              ) {
                                // Same-category switch (e.g. tonne -> kg): convert
                                // the already-entered quantity so it still means
                                // the same physical amount in the new unit.
                                nextQty = String(
                                  convertQuantity(
                                    parseFloat(ci.Quantity) || 0,
                                    Number(currentUom.BaseFactor),
                                    Number(nextUom.BaseFactor),
                                  ),
                                );
                              }

                              setCart((prev) =>
                                prev.map((c) =>
                                  c._key === ci._key
                                    ? { ...c, UOMCode: nextCode, Quantity: nextQty }
                                    : c,
                                ),
                              );
                            }}
                            className={selectCls}
                          >
                            <option value="">UOM…</option>
                            {ci.DefaultUOM && uomMap[ci.DefaultUOM] && (
                              <option
                                key={"default-" + ci.DefaultUOM}
                                value={ci.DefaultUOM}
                              >
                                {uomMap[ci.DefaultUOM].UOMName}
                                {uomMap[ci.DefaultUOM].Symbol
                                  ? ` (${uomMap[ci.DefaultUOM].Symbol}) · default`
                                  : " · default"}
                              </option>
                            )}
                            {relevant.map((u: any) => (
                              <option key={u.UOMCode} value={u.UOMCode}>
                                {u.UOMName}
                                {u.Symbol ? ` (${u.Symbol})` : ""}
                              </option>
                            ))}
                            {ci.UOMCode &&
                              ci.UOMCode !== ci.DefaultUOM &&
                              !relevant.some((u: any) => u.UOMCode === ci.UOMCode) &&
                              !extraAlternates.some((u) => u.UOMCode === ci.UOMCode) && (
                                <option value={ci.UOMCode}>
                                  {uomMap[ci.UOMCode]?.UOMName ?? ci.UOMCode}
                                </option>
                              )}
                            {extraAlternates.length > 0 && (
                              <optgroup label="Tagged for this item">
                                {extraAlternates.map((u) => (
                                  <option key={u.UOMCode} value={u.UOMCode}>
                                    {u.UOMName}
                                    {u.Symbol ? ` (${u.Symbol})` : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        );
                      })()}
                      <ChevronDown
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="space-y-1.5">
                    <label className={`md:hidden ${LBL}`}>
                      Quantity *
                    </label>
                    <div className="relative">
                      <Hash
                        size={12}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={ci.Quantity}
                        onChange={(e) =>
                          updateCartItem(ci._key, "Quantity", e.target.value)
                        }
                        className={`${inputCls} pl-8 h-10 font-heading tabular-nums`}
                        placeholder="0.00"
                      />
                    </div>
                    {/* Live equivalents in this item's other tagged UOMs */}
                    {ci.ItemId &&
                      ci.UOMCode &&
                      parseFloat(ci.Quantity) > 0 &&
                      (() => {
                        const itemAlternates = alternatesForItem(
                          itemUomAlternates,
                          ci.ItemId,
                        );
                        const fromFactor = getItemUomFactor(
                          itemUomAlternates,
                          ci.ItemId,
                          ci.UOMCode,
                          ci.DefaultUOM,
                        );
                        if (fromFactor == null || itemAlternates.length === 0)
                          return null;
                        const others: { label: string; qty: number }[] = [];
                        if (ci.DefaultUOM && ci.DefaultUOM !== ci.UOMCode) {
                          others.push({
                            label:
                              uomMap[ci.DefaultUOM]?.Symbol ||
                              uomMap[ci.DefaultUOM]?.UOMName ||
                              ci.DefaultUOM,
                            qty: convertItemQuantity(
                              parseFloat(ci.Quantity) || 0,
                              fromFactor,
                              1,
                            ),
                          });
                        }
                        for (const a of itemAlternates) {
                          if (a.uomCode === ci.UOMCode) continue;
                          others.push({
                            label: a.symbol || a.uomName || a.uomCode,
                            qty: convertItemQuantity(
                              parseFloat(ci.Quantity) || 0,
                              fromFactor,
                              a.conversionFactor,
                            ),
                          });
                        }
                        if (others.length === 0) return null;
                        return (
                          <p className="text-[0.625rem] text-muted-foreground mt-1">
                            ≈{" "}
                            {others
                              .map(
                                (o) =>
                                  `${o.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${o.label}`,
                              )
                              .join(" · ")}
                          </p>
                        );
                      })()}
                  </div>

                  {/* Remove */}
                  <div className="flex items-start pt-0 md:pt-0">
                    <button
                      type="button"
                      onClick={() => removeCartRow(ci._key)}
                      disabled={cart.length === 1}
                      title="Remove row"
                      aria-label="Remove row"
                      className={`${ACT} h-10 w-10 hover:text-destructive hover:border-destructive`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Remarks — always full width below, only shown when item picked */}
                {ci.ItemId && (
                  <div className="mt-3 pt-3 border-t border-foreground/15">
                    <input
                      value={ci.Remarks}
                      onChange={(e) =>
                        updateCartItem(ci._key, "Remarks", e.target.value)
                      }
                      placeholder="Line remarks (optional)"
                      className={`${inputCls} h-9 py-1.5`}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Cart summary */}
          {cart.some((ci) => ci.ItemId && ci.Quantity) && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm mt-1 -mx-4 -mb-4" style={{ borderTop: RULE }}>
              <span className="text-muted-foreground">
                <span className="font-heading font-semibold text-foreground tabular-nums">
                  {cart.filter((ci) => ci.ItemId).length}
                </span>{" "}
                item{cart.filter((ci) => ci.ItemId).length !== 1 ? "s" : ""}
                {(() => {
                  // Bags and tonnes don't add up — one total per unit.
                  const byUom = new Map<string, number>();
                  for (const ci of cart) {
                    if (!ci.ItemId || !Number(ci.Quantity)) continue;
                    const u = uomMap[ci.UOMCode]?.Symbol || uomMap[ci.UOMCode]?.UOMName || ci.UOMCode || "—";
                    byUom.set(u, (byUom.get(u) || 0) + Number(ci.Quantity));
                  }
                  return Array.from(byUom.entries()).map(([u, q]) => (
                    <span key={u}>
                      {" · "}
                      <span className="font-heading font-semibold text-foreground tabular-nums">
                        {q.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>{" "}
                      {u}
                    </span>
                  ));
                })()}
              </span>
              {cartIsValid ? <SheetMark text="Ready to save" tone="done" /> : <SheetMark text="Complete every item" tone="waiting" />}
            </div>
          )}
        </div>
      </div>

      {/* Save bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-card" style={{ border: RULE }}>
        <p className="text-[0.6875rem] text-muted-foreground hidden sm:block">
          {canSave ? "Ready to save." : "Fill in the required fields to save."}
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={resetFields}
            disabled={
              isSaving ||
              (!header.companyId &&
                !header.projectId &&
                !header.reason.trim() &&
                !header.remarks.trim() &&
                cart.every((ci) => !ci.ItemId && !ci.Quantity))
            }
            className={`${KEY_LINE} flex-1 sm:flex-none h-9 px-4`}
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving || saved}
            className={`${KEY_INK} flex-1 sm:flex-none h-9 px-5 whitespace-nowrap`}
          >
            {saved ? (
              <Check size={14} />
            ) : isSaving ? (
              <span className="w-3.5 h-3.5 border-2 border-card/30 border-t-card rounded-full animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saved
              ? "Saved"
              : isSaving
                ? "Saving…"
                : editingId
                  ? "Update request"
                  : "Save request"}
          </button>
        </div>
      </div>
    </div>
  );
}
