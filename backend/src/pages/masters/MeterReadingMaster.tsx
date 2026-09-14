import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, Search, Plus, Pencil, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
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

const PAGE_KEY = "meter-reading-master";
const STATUS_OPTIONS = ["Active", "Inactive", "Transferred", "Disconnected"] as const;
const inputCls = "px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const fieldCls = "w-full px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 text-foreground";

const STATUS_STYLE: Record<string, string> = {
  Active: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
  Inactive: "bg-muted border-border text-muted-foreground",
  Transferred: "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Disconnected: "bg-red-500/10 border-red-500/20 text-red-600",
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
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white">
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
        {error && <div className="text-sm text-red-500">Failed to load meters.</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No meters registered yet.
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5">Flat</th>
                  <th className="text-left px-4 py-2.5">Meter Box</th>
                  <th className="text-left px-4 py-2.5">Meter No.</th>
                  <th className="text-left px-4 py-2.5">Provider</th>
                  <th className="text-left px-4 py-2.5">Billing Cycle</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.Id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium text-foreground">{m.CustomerName}</td>
                    <td className="px-4 py-2.5">{[m.BlockName, m.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{m.MeterBoxNumber || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{m.MeterNumber}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.ProviderName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.BillingCycle}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${STATUS_STYLE[m.Status] || ""}`}>{m.Status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {rights.canEdit && (
                          <button onClick={() => { setEditing(m); setFormOpen(true); }} title="Edit" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
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
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading text-base">{isEdit ? "Edit Meter" : "Add Meter"}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          {!isEdit ? (
            <div>
              <label className={labelCls}>Customer / Booking</label>
              <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={fieldCls}>
                <option value="">Select customer…</option>
                {directoryRows.map((c) => (
                  <option key={c.Id} value={c.Id}>{c.CustomerName} — {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")} ({c.BookingNo})</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div><p className="text-muted-foreground">Customer</p><p className="font-medium text-foreground">{meter!.CustomerName}</p></div>
              <div><p className="text-muted-foreground">Project</p><p className="font-medium text-foreground">{meter!.ProjectName || "—"}</p></div>
              <div><p className="text-muted-foreground">Flat</p><p className="font-medium text-foreground">{[meter!.BlockName, meter!.UnitNo].filter(Boolean).join(" / ") || "—"}</p></div>
            </div>
          )}
          {!isEdit && selectedBooking && "ProjectName" in selectedBooking && (
            <div className="grid grid-cols-3 gap-3 text-xs rounded-lg bg-muted/30 p-2.5">
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
              <div><label className={labelCls}>Opening Reading Date</label><input type="date" value={openingReadingDate} onChange={(e) => setOpeningReadingDate(e.target.value)} className={fieldCls} /></div>
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
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
