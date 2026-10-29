import * as vehApi from "@/api/vehicleInOutApi";
import { toast } from "sonner";
import { XCircle, ChevronDown, Camera, Filter, Package } from "lucide-react";
import { inpSel, FieldLabel, SectionCard, SectionTitle, InfoPill } from "./config";
import type { VIOState } from "./useVehicleInOut";

// The purchase order a vehicle delivers against, its supplier and the lines received.
export function VIOPoSupplier({ m }: { m: VIOState }) {
  const { errors, setShowCamera, setCameraError, receivedQtyByItem, setReceivedQtyByItem, photoByItem, setPhotoByItem, setCapturingPoItemId, qualityByItem, setQualityByItem, brandByItem, setBrandByItem, setWeightByItem, weightByItem, form, pf, suppliers, filteredPOs, poItemsRemaining, loadingPOItems } = m;
  return (
    <>
      {/* ── Section 2: PO & Supplier ── */}
      <SectionCard>
        <SectionTitle
          icon={Filter}
          label="Purchase Order & Supplier"
          sub="Select a PO — supplier is fetched automatically"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* PO */}
          <div>
            <FieldLabel required>Purchase Order</FieldLabel>
            <div className="relative">
              <select
                value={form.poId ?? ""}
                onChange={(e) => {
                  const id = e.target.value
                    ? Number(e.target.value)
                    : null;
                  const po = filteredPOs.find(
                    (p: any) => p.PurchaseOrderID === id,
                  );
                  pf({
                    poId: id,
                    poNumber: po?.DocNo || po?.PurchaseOrderNo || "",
                    // Auto-fetch supplier from the selected PO —
                    // PO now drives supplier, not the other way
                    // round.
                    supplierId: po?.SupplierID ?? null,
                    supplierName: po?.SupplierName ?? "",
                    contactPerson:
                      (suppliers as any[]).find(
                        (s: any) => Number(s.id) === Number(po?.SupplierID),
                      )?.contactPerson ?? "",
                    // Auto-fill Company + Project straight from the
                    // PO too, same as GRN.tsx does.
                    companyId: po?.CompanyId ?? form.companyId,
                    projectId: po?.ProjectId ?? form.projectId,
                  });
                  // Switching POs invalidates any received-qty
                  // entered against the previous PO's line items.
                  setReceivedQtyByItem({});
                  setPhotoByItem({});
                  setQualityByItem({});
                  setBrandByItem({});
                  setWeightByItem({});
                }}
                className={`${inpSel} ${errors.poId ? "border-destructive/60" : ""}`}
              >
                <option value="">
                  {filteredPOs.length === 0 ? "No POs available" : "Select PO…"}
                </option>
                {filteredPOs.map((po: any) => (
                  <option
                    key={po.PurchaseOrderID}
                    value={po.PurchaseOrderID}
                  >
                    {po.DocNo || po.PurchaseOrderNo}
                    {po.SupplierName ? ` — ${po.SupplierName}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            {errors.poId && (
              <p className="text-[0.625rem] text-destructive mt-1">
                {errors.poId}
              </p>
            )}
          </div>

          {/* Supplier — auto-filled from the selected PO and locked
              while a PO is selected (it's derived, not independent
              input). Only editable for a standalone (no-PO) entry. */}
          <div>
            <FieldLabel>Supplier</FieldLabel>
            <div className="relative">
              <select
                value={form.supplierId ?? ""}
                onChange={(e) => {
                  const id = e.target.value
                    ? Number(e.target.value)
                    : null;
                  const sup = (suppliers as any[]).find(
                    (s: any) => Number(s.id) === id,
                  );
                  pf({
                    supplierId: id,
                    supplierName: sup?.label ?? "",
                    contactPerson: sup?.contactPerson ?? "",
                  });
                }}
                disabled={!!form.poId}
                title={form.poId ? "Supplier is set by the selected PO" : undefined}
                className={`appearance-none ${inpSel} ${form.poId ? "opacity-70 cursor-not-allowed bg-card" : ""}`}
              >
                <option value="">Select Supplier…</option>
                {(suppliers as any[]).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>
        </div>

        {form.supplierName && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            <InfoPill label="Supplier" value={form.supplierName} />
            {form.contactPerson && (
              <InfoPill
                label="Contact Person"
                value={form.contactPerson}
              />
            )}
            {form.poNumber && (
              <InfoPill label="PO No" value={form.poNumber} mono />
            )}
          </div>
        )}

        {/* PO Items — enter how much this specific lot/vehicle is
            delivering, per line item. Capped at what's actually
            left on the PO (ordered minus everything already
            received across other Vehicle In/Out entries for the
            same PO) — this is the "10 + 20 + 70 of 100" flow. */}
        {form.poId && (
          <div className="border border-foreground/30 overflow-hidden">
            <div className="px-4 py-2.5 bg-card border-b border-foreground/30 flex items-center gap-2">
              <Package size={13} className="text-muted-foreground" />
              <span className="text-[0.6875rem] font-heading font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                PO Items — Qty Received (This Lot)
              </span>
              <span className="ml-auto text-[0.625rem] text-muted-foreground">
                {loadingPOItems
                  ? "Loading…"
                  : `${poItemsRemaining.length} item${poItemsRemaining.length !== 1 ? "s" : ""}`}
              </span>
            </div>
            {poItemsRemaining.length === 0 && !loadingPOItems ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No items on this PO.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-foreground/30 bg-card">
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">#</th>
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Item</th>
                      <th className="px-4 py-2 text-right text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Ordered</th>
                      <th className="px-4 py-2 text-right text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Received So Far</th>
                      <th className="px-4 py-2 text-right text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Remaining</th>
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">UOM</th>
                      <th className="px-4 py-2 text-right text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Qty This Lot</th>
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Weight</th>
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Brand</th>
                      <th className="px-4 py-2 text-left text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Quality</th>
                      <th className="px-4 py-2 text-center text-[0.625rem] uppercase tracking-wider text-muted-foreground font-heading">Photo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/10">
                    {poItemsRemaining.map((it, i) => {
                      const raw = receivedQtyByItem[it.poItemId] ?? "";
                      const entered = parseFloat(raw) || 0;
                      const overLimit = entered > it.remainingQty + 1e-6;
                      return (
                        <tr key={it.poItemId} className="hover:bg-primary/5 transition-colors">
                          <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{it.itemName || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-heading">{it.orderedQty}</td>
                          <td className="px-4 py-2.5 text-right font-heading text-muted-foreground">{it.receivedSoFar}</td>
                          <td className="px-4 py-2.5 text-right font-heading font-semibold">
                            {entered > 0 ? (
                              <span className="inline-flex items-baseline gap-1.5">
                                <span className="text-muted-foreground line-through">
                                  {it.remainingQty}
                                </span>
                                <span
                                  className={
                                    overLimit
                                      ? "text-destructive"
                                      : "text-primary"
                                  }
                                >
                                  {Math.max(it.remainingQty - entered, 0)}
                                </span>
                              </span>
                            ) : (
                              <span
                                className={
                                  it.remainingQty === 0
                                    ? "text-muted-foreground"
                                    : "text-primary"
                                }
                              >
                                {it.remainingQty}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{it.uomName || "—"}</td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number"
                              min={0}
                              max={it.remainingQty}
                              step="any"
                              value={raw}
                              disabled={it.remainingQty === 0}
                              onChange={(e) => {
                                const nextVal = e.target.value;
                                const nextEntered =
                                  parseFloat(nextVal) || 0;
                                if (
                                  nextEntered > it.remainingQty + 1e-6 &&
                                  entered <= it.remainingQty + 1e-6
                                ) {
                                  toast.error(
                                    `${it.itemName || "Item"}: quantity can't be greater than ${it.remainingQty} ${it.uomName || ""}`.trim(),
                                  );
                                }
                                setReceivedQtyByItem((prev) => ({
                                  ...prev,
                                  [it.poItemId]: nextVal,
                                }));
                              }}
                              placeholder="0"
                              className={`w-24 px-2 py-1.5 border bg-card text-right font-heading text-xs focus:outline-none ${
                                overLimit ? "border-destructive text-destructive" : "border-foreground/30"
                              } ${it.remainingQty === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            {/* Optional: what this line weighed on arrival. */}
                            <div className="flex items-center">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={weightByItem[it.poItemId]?.value ?? ""}
                                onChange={(e) =>
                                  setWeightByItem((prev) => ({
                                    ...prev,
                                    [it.poItemId]: { value: e.target.value, unit: prev[it.poItemId]?.unit ?? "kg" },
                                  }))
                                }
                                disabled={entered <= 0}
                                placeholder="—"
                                aria-label={`Weight of ${it.itemName || "item"}`}
                                className={`w-20 px-2 py-1.5 border border-foreground/30 bg-card text-right font-heading text-xs focus:outline-none ${entered <= 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                              />
                              <select
                                value={weightByItem[it.poItemId]?.unit ?? "kg"}
                                onChange={(e) =>
                                  setWeightByItem((prev) => ({
                                    ...prev,
                                    [it.poItemId]: { value: prev[it.poItemId]?.value ?? "", unit: e.target.value as vehApi.VehicleInOutWeightUnit },
                                  }))
                                }
                                disabled={entered <= 0}
                                aria-label="Weight unit"
                                className={`px-1.5 py-1.5 border border-l-0 border-foreground/30 bg-card text-xs focus:outline-none ${entered <= 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                              >
                                <option value="kg">kg</option>
                                <option value="tonne">tonne</option>
                              </select>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              value={brandByItem[it.poItemId] ?? ""}
                              onChange={(e) =>
                                setBrandByItem((prev) => ({
                                  ...prev,
                                  [it.poItemId]: e.target.value,
                                }))
                              }
                              placeholder="Optional"
                              maxLength={100}
                              className="w-28 px-2 py-1.5 border border-foreground/30 bg-card text-xs focus:outline-none"
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={qualityByItem[it.poItemId] ?? ""}
                              onChange={(e) =>
                                setQualityByItem((prev) => ({
                                  ...prev,
                                  [it.poItemId]: e.target
                                    .value as vehApi.VehicleInOutItemQuality | "",
                                }))
                              }
                              disabled={entered <= 0}
                              className={`px-2 py-1.5 border bg-card text-xs font-medium focus:outline-none ${
                                entered <= 0 ? "opacity-50 cursor-not-allowed" : ""
                              } ${
                                qualityByItem[it.poItemId] === "Excellent"
                                  ? "border-foreground/40 text-foreground"
                                  : qualityByItem[it.poItemId] === "Good"
                                    ? "border-foreground/40 text-foreground"
                                    : qualityByItem[it.poItemId] === "Bad"
                                      ? "border-foreground/40 text-foreground"
                                      : "border-foreground/30 text-muted-foreground"
                              }`}
                            >
                              <option value="">—</option>
                              <option value="Excellent">Excellent</option>
                              <option value="Good">Good</option>
                              <option value="Bad">Bad</option>
                            </select>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center">
                              {photoByItem[it.poItemId] ? (
                                <div className="relative group">
                                  <img
                                    src={photoByItem[it.poItemId]}
                                    alt={`${it.itemName || "Item"} capture`}
                                    className="w-9 h-9 object-cover border border-foreground/30 cursor-pointer"
                                    onClick={() => {
                                      setCameraError(null);
                                      setCapturingPoItemId(it.poItemId);
                                      setShowCamera(true);
                                    }}
                                    title="Tap to retake"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPhotoByItem((prev) => {
                                        const next = { ...prev };
                                        delete next[it.poItemId];
                                        return next;
                                      })
                                    }
                                    title="Remove photo"
                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <XCircle size={12} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCameraError(null);
                                    setCapturingPoItemId(it.poItemId);
                                    setShowCamera(true);
                                  }}
                                  title="Capture a real-time photo of this item"
                                  className="w-9 h-9 border border-dashed border-foreground/30 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                                >
                                  <Camera size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </>
  );
}
