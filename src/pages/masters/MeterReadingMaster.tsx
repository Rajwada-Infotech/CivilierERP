import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, Search, Plus, Pencil, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, TD, TH } from "@/components/maintenance/maintParts";
import { HR_FIELD, HR_HEAD, HR_LBL } from "@/components/hrpayroll/HrUi";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, KEY_RED_SOLID } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import {
  getMeters,
  createMeter,
  updateMeter,
  getElectricityProviders,
  type MeterRow,
} from "@/api/electricityMaintenanceApi";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const PAGE_KEY = "meter-reading-master";
const STATUS_OPTIONS = ["Active", "Inactive", "Transferred", "Disconnected"] as const;
const inputCls = `${HR_FIELD} w-auto`;
const labelCls = `block mb-1.5 ${HR_LBL}`;
const fieldCls = HR_FIELD;

// Meter status as sheet marks: solid = active, hatched = transferred, red = disconnected, empty = inactive.
const STATUS_TONE: Record<string, MarkTone> = {
  Active: "done",
  Inactive: "draft",
  Transferred: "waiting",
  Disconnected: "stopped",
};

export default function MeterReadingMaster() {
  const rights = usePageRights(PAGE_KEY);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MeterRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["electricity-meters", search],
    queryFn: () => getMeters({ search }),
  });
  const rows = Array.isArray(data) ? data : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Meter Reading Master"]} />
      <MaintenanceShell
        title="Meter Reading Master"
        subtitle="Ties a confirmed customer/booking to their physical electricity meter"
        icon={Gauge}
        action={
          rights.canCreate && (
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> Add Meter
            </button>
          )
        }
      >
        <div className="relative w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, flat, meter…" className={`pl-8 pr-3 w-full ${inputCls}`} />
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-destructive">Failed to load meters.</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className="bg-card border border-dashed border-foreground/40 py-10 text-center text-sm text-muted-foreground">
            No meters registered yet.
          </div>
        )}

        {rows.length > 0 && (
          <div className="bg-card border border-foreground overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Flat</th>
                  <th className={TH}>Meter Box</th>
                  <th className={TH}>Meter No.</th>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Billing Cycle</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.Id} className="hover:bg-primary/5">
                    <td className={`${TD} font-medium text-foreground`}>{m.CustomerName}</td>
                    <td className={TD}>{[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className={`${TD} font-heading tabular-nums text-xs`}>{m.MeterBoxNumber || "—"}</td>
                    <td className={`${TD} font-heading tabular-nums text-xs`}>{m.MeterNumber}</td>
                    <td className={`${TD} text-muted-foreground`}>{m.ProviderName}</td>
                    <td className={`${TD} text-muted-foreground`}>{m.BillingCycle}</td>
                    <td className={TD}>
                      <SheetMark text={m.Status} tone={STATUS_TONE[m.Status] ?? "draft"} />
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1">
                        {rights.canEdit && (
                          <button onClick={() => { setEditing(m); setFormOpen(true); }} title="Edit" className={ICON_ACT}>
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MaintenanceShell>

      {formOpen && (
        <MeterFormDialog
          meter={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); queryClient.invalidateQueries({ queryKey: ["electricity-meters"] }); }}
        />
      )}
    </>
  );
}

function MeterFormDialog({ meter, onClose, onSaved }: { meter: MeterRow | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!meter;
  const [bookingId, setBookingId] = useState(meter ? String(meter.BookingId) : "");
  const [meterBoxNumber, setMeterBoxNumber] = useState(meter?.MeterBoxNumber || "");
  const [meterNumber, setMeterNumber] = useState(meter?.MeterNumber || "");
  const [providerId, setProviderId] = useState(meter ? String(meter.ProviderId) : "");
  const [connectionType, setConnectionType] = useState(meter?.ConnectionType || "");
  const [meterType, setMeterType] = useState(meter?.MeterType || "");
  const [billingCycle, setBillingCycle] = useState(meter?.BillingCycle || "Monthly");
  const [openingReading, setOpeningReading] = useState(meter ? String(meter.OpeningReading) : "0");
  const [openingReadingDate, setOpeningReadingDate] = useState(meter?.OpeningReadingDate?.slice(0, 10) || "");
  const [status, setStatus] = useState(meter?.Status || "Active");
  const [remarks, setRemarks] = useState(meter?.Remarks || "");
  const [saving, setSaving] = useState(false);

  const { data: directory } = useQuery({ queryKey: ["maintenance-directory", ""], queryFn: () => getMaintenanceDirectory(""), enabled: !isEdit });
  const { data: providers } = useQuery({ queryKey: ["electricity-providers"], queryFn: getElectricityProviders });
  const directoryRows = Array.isArray(directory) ? directory : [];
  const selectedBooking = directoryRows.find((c) => String(c.Id) === bookingId);

  const handleSave = async () => {
    if (!isEdit && !bookingId) { toast.error("Select a customer/booking"); return; }
    if (!meterNumber.trim()) { toast.error("Meter Number is required"); return; }
    if (!providerId) { toast.error("Electricity Provider is required"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateMeter(meter!.Id, {
          meterBoxNumber: meterBoxNumber || undefined, providerId: Number(providerId), connectionType: connectionType || undefined,
          meterType: meterType || undefined, billingCycle, status, remarks: remarks || undefined,
        });
        toast.success("Meter updated");
      } else {
        await createMeter({
          bookingId: Number(bookingId), meterBoxNumber: meterBoxNumber || undefined, meterNumber: meterNumber.trim(),
          providerId: Number(providerId), connectionType: connectionType || undefined, meterType: meterType || undefined,
          billingCycle, openingReading: Number(openingReading) || 0, openingReadingDate: openingReadingDate || undefined, remarks: remarks || undefined,
        });
        toast.success("Meter created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save meter");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-lg max-h-[88vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>{isEdit ? "Edit Meter" : "Add Meter"}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          {!isEdit ? (
            <div>
              <label className={labelCls}>Customer / Booking</label>
              <SearchableNativeSelect value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={fieldCls}>
                <option value="">Select customer…</option>
                {directoryRows.map((c) => (
                  <option key={c.Id} value={c.Id}>{c.CustomerName} — {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")} ({c.BookingNo})</option>
                ))}
              </SearchableNativeSelect>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{meter!.CustomerName}</p></div>
              <div><p className="text-muted-foreground">Project</p><p className="font-medium text-foreground">{meter!.ProjectName || "—"}</p></div>
              <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[meter!.BlockName, meter!.UnitNo].filter(Boolean).join(" / ") || "—"}</p></div>
            </div>
          )}
          {!isEdit && selectedBooking && "ProjectName" in selectedBooking && (
            <div className="grid grid-cols-3 gap-3 text-xs border border-foreground/20 bg-foreground/5 p-2.5">
              <div><p className="text-muted-foreground">Project</p><p className="font-medium text-foreground">{(selectedBooking as any).ProjectName || "—"}</p></div>
              <div><p className="text-muted-foreground">Tower</p><p className="font-medium text-foreground">{(selectedBooking as any).BlockName || "—"}</p></div>
              <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{(selectedBooking as any).UnitNo || "—"}</p></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Meter Box Number</label><input value={meterBoxNumber} onChange={(e) => setMeterBoxNumber(e.target.value)} className={fieldCls} /></div>
            <div><label className={labelCls}>Meter Number</label><input value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} disabled={isEdit} className={`${fieldCls} disabled:opacity-60`} /></div>
          </div>

          <div>
            <label className={labelCls}>Electricity Provider</label>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={fieldCls}>
              <option value="">Select provider…</option>
              {(providers || []).map((p) => (<option key={p.Id} value={p.Id}>{p.Name}</option>))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Connection Type</label><input value={connectionType} onChange={(e) => setConnectionType(e.target.value)} placeholder="e.g. Single Phase" className={fieldCls} /></div>
            <div><label className={labelCls}>Meter Type</label><input value={meterType} onChange={(e) => setMeterType(e.target.value)} placeholder="e.g. Digital" className={fieldCls} /></div>
          </div>

          <div>
            <label className={labelCls}>Billing Cycle</label>
            <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as "Monthly" | "3 Monthly")} className={fieldCls}>
              <option value="Monthly">Monthly</option>
              <option value="3 Monthly">3 Monthly</option>
            </select>
          </div>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Opening Reading</label><input type="number" value={openingReading} onChange={(e) => setOpeningReading(e.target.value)} className={fieldCls} /></div>
              <div><label className={labelCls}>Opening Reading Date</label><DateInput value={openingReadingDate} onChange={(e) => setOpeningReadingDate(e.target.value)} className={fieldCls} /></div>
            </div>
          )}

          {isEdit && (
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof STATUS_OPTIONS[number])} className={fieldCls}>
                {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${HR_FIELD} h-auto py-2 resize-none`} />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
