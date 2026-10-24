// Change Unit: moves a booking to another unit with a reason. Offers only free units of the booking's own project
// (it offered every active unit, so a booked or held unit, or one in another project, was offered and then refused).
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Repeat } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { API, KEY_LINE, KEY_RED, RULE, fetchUnits, inputCls, labelCls } from "./config";

export function ChangeUnitDialog({ booking, onClose }: { booking: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [newId, setNewId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: units = [], isLoading } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });

  const options = useMemo(
    () => (units as any[])
      .filter((u: any) => u.IsActive && u.Id !== booking.UnitId && !(u.LockBookingNo || u.LockHoldId)
        && (booking.ProjectId == null || u.ProjectId === booking.ProjectId))
      .map((u: any) => ({ value: String(u.Id), label: [u.BlockName, u.UnitName, u.UnitType].filter(Boolean).join(" · ") })),
    [units, booking],
  );

  const save = async () => {
    if (!newId) return void toast.error("Select a unit.");
    if (!reason.trim()) return void toast.error("Enter the reason.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.Id}/change-unit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NewUnitId: parseInt(newId), Reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the unit.");
      toast.success(`Unit changed to ${data.unitNo}`);
      ["crm-bookings", "unit-master"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
            <Repeat size={14} /> Change unit · <span className="tabular-nums normal-case tracking-normal text-sm">{booking.BookingNo}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Now {[booking.ProjectName, booking.BlockName, booking.UnitNo].filter(Boolean).join(" · ") || "no unit"}.</p>
        <div>
          <label className={labelCls}>New unit *</label>
          <SearchableSelect value={newId} onChange={setNewId}
            placeholder={isLoading ? "Loading units…" : options.length ? "Select unit" : "No free unit in this project"}
            searchPlaceholder="Search block or unit…" options={options} />
        </div>
        <div>
          <label className={labelCls}>Reason *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why the unit is changing"
            className={`${inputCls} h-auto py-2 resize-none`} />
        </div>
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={save} disabled={saving || !newId || !reason.trim()} className={`${KEY_RED} h-9 px-4`}>{saving ? "Changing…" : "Change unit"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
