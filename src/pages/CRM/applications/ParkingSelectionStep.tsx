// Wizard step: parking.
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Trash2, ParkingSquare, IndianRupee, Lock } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useGstRates, computeUnitParkingGst } from "@/lib/crmGst";
import { PARKING_API, KEY_INK } from "./config";
import { GstBreakdownBox, GstGrandTotalText } from "./GstBreakdown";

// ── Step 2: Parking Selection ──────────────────────────────────────────────────
export const ParkingSelectionStep: React.FC<{
  applicationId: number; projectId: string; blockId: string;
  computedTotal: number;
  // Same Draft/Pending gate as canEditUnitSelection on the parent — parking
  // picked here is still just an Application-stage hold (see crmParking.js
  // POST /standalone), converted into a real CrmParkingAllotment only once
  // the Application's Booking exists, so it has to stop moving at the exact
  // same point the unit does: once Approved, a Booking either already exists
  // or is expected imminently, and the pick can't change out from under it.
  canEdit: boolean;
  wizardAppStatus: string | null;
}> = ({ applicationId, projectId, blockId, computedTotal, canEdit, wizardAppStatus }) => {
  const { data: allotments = [], refetch: refetchParking } = useQuery({
    queryKey: ["crm-app-parking", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
  });

  // Truly-available parking, computed server-side against every allotment
  // and hold system-wide (not just this application's own picks) — see
  // crmParking.js GET /available. Refetched alongside allotments so a slot
  // this step itself just took disappears from "available" immediately too.
  const { data: parkingAvailability, refetch: refetchAvailable } = useQuery({
    queryKey: ["crm-parking-available", projectId, blockId],
    queryFn: async () => {
      if (!projectId) return { rates: [], unratedTypesWithInventory: [] };
      const params = new URLSearchParams({ projectId });
      if (blockId) params.set("blockId", blockId);
      const r = await fetchWithAuth(`${PARKING_API}/available?${params}`);
      return r.ok ? r.json() : { rates: [], unratedTypesWithInventory: [] };
    },
    enabled: !!projectId,
  });
  const availableRates = parkingAvailability?.rates || [];
  // Slot inventory that exists (Parking Slot Master) but has no matching
  // rate (Parking Rate Master) — distinct from "no parking at all", which
  // is what the old flat "no parking rates configured" message conflated.
  const unratedTypesWithInventory: string[] = parkingAvailability?.unratedTypesWithInventory || [];

  const refetchAll = () => { refetchParking(); refetchAvailable(); };

  const [selectedType, setSelectedType] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [rateOverride, setRateOverride] = useState("");
  const [adding, setAdding] = useState(false);
  const [rateEditing, setRateEditing] = useState(false);

  // Reset the slot/quantity pick (not the type) whenever the chosen type's
  // own available list changes under it — e.g. someone else just took the
  // one slot this staff member had highlighted.
  const currentType = (availableRates as any[]).find((r: any) => r.ParkingType === selectedType) || null;
  useEffect(() => {
    setSelectedSlotId("");
    const rate = (availableRates as any[]).find((r: any) => r.ParkingType === selectedType);
    setRateOverride(rate && rate.Charge != null ? String(rate.Charge) : "");
    // Unrated types have no master price — jump straight to the editable input.
    setRateEditing(!rate || !!rate.NeedsRate);
  }, [selectedType]);

  const handleAdd = async () => {
    if (!currentType) return;
    if (!currentType.HasSlots) { toast.error("No slots available for this parking type"); return; }
    if (!selectedSlotId) { toast.error("Select a slot"); return; }
    if (currentType.NeedsRate && (!rateOverride || Number(rateOverride) <= 0)) {
      toast.error("Enter a price for this parking type"); return;
    }
    setAdding(true);
    try {
      const body: any = {
        ApplicationId: applicationId,
        ParkingSlotId: parseInt(selectedSlotId), Quantity: 1,
      };
      if (currentType.NeedsRate) {
        // No ParkingMaster row — send type and mandatory price directly.
        body.ParkingType = currentType.ParkingType;
        body.RateOverride = rateOverride;
      } else {
        body.ParkingMasterId = currentType.ParkingMasterId;
        // Only send RateOverride when the user explicitly changed it from the master rate.
        if (rateEditing && rateOverride && Number(rateOverride) !== Number(currentType.Charge)) {
          body.RateOverride = rateOverride;
        }
      }
      const res = await fetchWithAuth(`${PARKING_API}/standalone`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to add ${currentType.ParkingType}`);
      const addedBase = Number(
        currentType.NeedsRate || (rateEditing && rateOverride)
          ? rateOverride
          : currentType.Charge
      ) || 0;
      const addedTotal = parkingGstRates
        ? Math.round((addedBase + (addedBase * computeUnitParkingGst(computedTotal, parkingBase + addedBase, parkingGstRates).rate / 100)) * 100) / 100
        : Number(data.TotalAmount);
      toast.success(`${currentType.ParkingType} added — ₹${addedTotal.toLocaleString("en-IN")}`);
      setSelectedType(""); setSelectedSlotId(""); setRateOverride(""); setRateEditing(false);
      refetchAll();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveParking = async (a: any) => {
    try {
      // A slot pick is only a hold until the Booking is created (see
      // crmParking.js POST /standalone) — releasing it goes through the
      // hold-release route, not the allotment DELETE, since there's no
      // CrmParkingAllotment row yet to delete.
      const url = a.Kind === "Hold" ? `${PARKING_API}/hold/${a.Id}` : `${PARKING_API}/${a.Id}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchAll();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // Pre-tax base for the GST preview — see RateSnapshot note on the GET
  // /application/:applicationId route (both Allotment and Hold shapes carry it).
  const parkingBase = (allotments as any[]).reduce((s, a) => s + (Number(a.RateSnapshot) || 0) * (Number(a.Quantity) || 1), 0);
  const { data: parkingGstRates } = useGstRates();
  const parkingGstPreview = parkingGstRates ? computeUnitParkingGst(computedTotal, parkingBase, parkingGstRates) : null;
  const displayParkingTotal = (a: any) => {
    const base = (Number(a.RateSnapshot) || 0) * (Number(a.Quantity) || 1);
    if (!parkingGstPreview) return Number(a.TotalAmount || base);
    return Math.round((base + (base * parkingGstPreview.rate / 100)) * 100) / 100;
  };

  return (
    <div className="space-y-4">
      {/* Auto-filled charges summary — one brief line, same compact style
          as the Unit price preview on Step 1, instead of a 3-cell grid. */}
      <div className=" border border-border bg-muted/20 px-3 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
        <IndianRupee size={11} className="text-primary shrink-0" />
        Unit ₹{computedTotal.toLocaleString("en-IN")}
        {parkingBase > 0 && ` + Parking base ₹${parkingBase.toLocaleString("en-IN")}`}
        {" + GST = "}
        <span className="font-semibold text-foreground">
          Grand Total <GstGrandTotalText unitValue={computedTotal} parkingBase={parkingBase} />
        </span>
      </div>

      {/* GST preview — updates live the instant a parking type is added or
          removed, since that can cross the ₹45L bracket. */}
      {computedTotal > 0 && <GstBreakdownBox unitValue={computedTotal} parkingBase={parkingBase} />}

      {/* Already-added allotments */}
      <div className=" border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><ParkingSquare size={13} /> Selected Parking</label>
          {!canEdit && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <Lock size={11} /> {wizardAppStatus === "Approved" ? "Manage from Booking" : `Locked (${wizardAppStatus})`}
            </span>
          )}
        </div>
        {!canEdit && wizardAppStatus === "Approved" && (
          <p className="text-[0.6875rem] text-muted-foreground bg-muted/30 px-3 py-2">
            This application has been approved and a Booking has been created. To add, edit, or remove parking slots, open the Booking and go to the <strong>Parking &amp; Extra Charges</strong> tab.
          </p>
        )}
        {(allotments as any[]).length > 0 ? (
          <div className="space-y-1.5">
            {(allotments as any[]).map((a: any) => (
              <div key={`${a.Kind}-${a.Id}`} className="flex items-center justify-between text-xs bg-muted/30 px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  {a.CurrentParkingType} {a.SlotNo ? `— Slot ${a.SlotNo}` : `× ${a.Quantity}`} · ₹{displayParkingTotal(a).toLocaleString("en-IN")}
                  {a.Kind === "Hold" && (
                    <span title="Reserved — becomes a permanent allotment once this application's booking is created"
                      className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full border border-foreground/30 bg-card text-foreground">
                      Held
                    </span>
                  )}
                </span>
                {canEdit && (
                  <button onClick={() => handleRemoveParking(a)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No parking selected yet — optional.</p>
        )}
      </div>

      {/* Add parking — pick a type, then (if it has fixed slots) pick a slot */}
      {!canEdit ? null : !projectId ? (
        <p className="text-xs text-muted-foreground">Select a project in Step 1 to choose parking.</p>
      ) : (availableRates as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground">No parking configured for this project.</p>
      ) : (
        <div className=" border border-border p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Parking Type</label>
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
              className="w-full text-sm border border-border px-2 py-1.5 bg-background">
              <option value="">— Select a parking type —</option>
              {(availableRates as any[]).map((r: any) => {
                // No ParkingSlot rows entered for this type at all yet —
                // Ops hasn't set up inventory in Parking Slot Master.
                // Quantity-only selling is no longer offered as a fallback;
                // this type is simply unavailable until slots exist.
                const noneInBlock = r.HasSlots && r.AvailableSlots.length === 0;
                // "Sold out" only when the backend confirms zero slots of
                // this type are free ANYWHERE in the project (see
                // SoldOutProjectWide in crmParking.js GET /available).
                // Basement/Covered-style parking is often reserved
                // per-block, so a block-scoped zero doesn't necessarily
                // mean no inventory exists — it may just belong to another
                // block/tower.
                const soldOutEverywhere = noneInBlock && r.SoldOutProjectWide;
                const availableElsewhere = noneInBlock && !r.SoldOutProjectWide;
                const disabled = r.NoInventory || noneInBlock;
                return (
                  <option key={r.ParkingType} value={r.ParkingType} disabled={disabled}>
                    {r.ParkingType} — {r.NeedsRate ? "price required" : `₹${Number(r.Charge).toLocaleString("en-IN")} each`}
                    {r.HasSlots ? ` (${r.AvailableSlots.length} available)` : ""}
                    {r.NoInventory ? " — Not available (no slots set up yet)" : ""}
                    {soldOutEverywhere ? " — Sold out" : ""}
                    {availableElsewhere ? ` — None in this block (${r.FreeCountProjectWide} free in other blocks)` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          {currentType && currentType.HasSlots && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Available Slot</label>
              <select value={selectedSlotId} onChange={(e) => setSelectedSlotId(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                <option value="">— Select a slot —</option>
                {currentType.AvailableSlots.map((s: any) => (
                  <option key={s.Id} value={String(s.Id)}>Slot {s.SlotNo}</option>
                ))}
              </select>
            </div>
          )}

          {/* Defensive only — the dropdown disables this option, so a
              no-inventory type shouldn't normally reach here. */}
          {currentType && !currentType.HasSlots && (
            <p className="text-xs text-muted-foreground">
              No slots have been set up for {currentType.ParkingType} parking yet — ask an admin to add them in Parking Slot Master.
            </p>
          )}

          {/* Rate — for types with a master rate: locked by default, edit to override.
              For unrated types (NeedsRate): always editable, price is mandatory. */}
          {currentType && currentType.HasSlots && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">
                  Rate (₹ per unit){currentType.NeedsRate && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {!currentType.NeedsRate && (
                  !rateEditing ? (
                    <button
                      type="button"
                      onClick={() => setRateEditing(true)}
                      className="text-[0.6875rem] text-muted-foreground hover:text-primary flex items-center gap-0.5 transition-colors"
                      title="Override rate for this customer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setRateOverride(currentType ? String(currentType.Charge) : ""); setRateEditing(false); }}
                      className="text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
                      title="Reset to master rate"
                    >
                      ↺ Reset
                    </button>
                  )
                )}
              </div>
              {currentType.NeedsRate || rateEditing ? (
                <input
                  type="number" min={0}
                  value={rateOverride}
                  onChange={(e) => setRateOverride(e.target.value)}
                  autoFocus={currentType.NeedsRate}
                  placeholder={currentType.NeedsRate ? "Enter price…" : ""}
                  className="w-full text-sm border border-primary px-2.5 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              ) : (
                <div
                  className="w-full text-sm border border-border px-2.5 py-1.5 bg-muted/30 flex items-center justify-between cursor-default select-none"
                  title="Click Edit to change this rate"
                >
                  <span className="font-medium tabular-nums">
                    ₹{Number(rateOverride || currentType.Charge).toLocaleString("en-IN")}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
              )}
              {currentType.NeedsRate && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1">
                  No rate is configured in Parking Rate Master — enter the agreed price manually.
                </p>
              )}
              {!currentType.NeedsRate && rateEditing && rateOverride && Number(rateOverride) !== Number(currentType.Charge) && (
                <p className="text-[0.6875rem] text-foreground mt-1">
                  Master rate is ₹{Number(currentType.Charge).toLocaleString("en-IN")} — you're overriding to ₹{Number(rateOverride).toLocaleString("en-IN")}.
                </p>
              )}
              {!currentType.NeedsRate && !rateEditing && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1">
                  Master rate. Click <span className="font-medium">Edit</span> to set a negotiated price.
                </p>
              )}
            </div>
          )}

          {currentType && (
            <button onClick={handleAdd} disabled={adding || !currentType.HasSlots || !selectedSlotId}
              className={`${KEY_INK} h-9 px-4`}>
              {adding ? "Adding..." : `Add ${currentType.ParkingType}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
