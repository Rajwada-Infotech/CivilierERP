// The deed's Registry tab: the Sub-Registrar appointment (start → schedule → reschedule → complete / cancel), its
// documents, then the deed's registration and Index II. Formerly its own page; now scoped to the deed's booking.
import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { GRID_SHEET_KEYS, GridToneMark as SheetMark } from "@/components/crm/CrmDataTable";
// Drawn with the CRM record kit; the keys, labels, inputs and rules it uses map onto it.
const { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } = GRID_SHEET_KEYS;
import { API, deedTone, fmtDate, localDay } from "./config";
import { AutoStep, DateStep, DocumentCentre, Panel } from "./parts";

/** The booking's current registry tracker, its documents and history. Shared with the page (timeline, history). */
export function useDeedRegistry(bookingId: number | null | undefined) {
  const byBooking = useQuery({
    queryKey: ["crm-sales-deed-registry-by-booking", bookingId != null ? String(bookingId) : ""],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/registry/booking/${bookingId}`); return r.ok ? r.json() : null; },
    enabled: bookingId != null,
    staleTime: 15_000,
  });
  const registryId: number | null = byBooking.data?.Id ?? null;
  const detail = useQuery({
    queryKey: ["crm-sales-deed-registry-detail", registryId],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/registry/${registryId}`); return r.ok ? r.json() : null; },
    enabled: registryId != null,
    staleTime: 15_000,
  });
  return {
    registryId,
    registry: detail.data?.registry ?? byBooking.data ?? null,
    documents: (detail.data?.documents || []) as any[],
    history: (detail.data?.history || []) as any[],
    refetch: () => { byBooking.refetch(); if (registryId) detail.refetch(); },
  };
}

const EMPTY_COMPLETE = () => ({
  RegistrationNo: "", BookNo: "", PartNo: "", SubRegistrarOffice: "",
  RegistrationDate: localDay(), WitnessNames: "", BuyerAttended: false, SellerAttended: false,
});

export function RegistryTab({ detail, qpConfirmed, canCreate, canEdit, canCompleteOrCancel, canEditDeed, onSaveIndex2, savingIndex2, onChanged }: {
  detail: any; qpConfirmed: boolean;
  canCreate: boolean; canEdit: boolean; canCompleteOrCancel: boolean; canEditDeed: boolean;
  onSaveIndex2: (date: string) => void; savingIndex2: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { registryId, registry, documents, refetch } = useDeedRegistry(detail.BookingId);
  const { data: eligible = [] } = useQuery({
    queryKey: ["crm-sales-deed-registry-eligible"],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/registry/eligible-bookings`); return r.ok ? r.json() : []; },
    staleTime: 60_000,
  });
  const startEligible = (eligible as any[]).some((b: any) => String(b.Id) === String(detail.BookingId));

  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const verified = required.filter((d) => d.Status === "Verified").length;
  const locked = !!registry && ["Completed", "Cancelled"].includes(registry.Status);
  const status: string | undefined = registry?.Status;

  const [starting, setStarting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState<"first" | "reschedule" | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [office, setOffice] = useState("");
  const [reason, setReason] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [complete, setComplete] = useState(EMPTY_COMPLETE);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const changed = (alsoPage = false) => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-by-booking"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-detail", registryId] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-eligible"] });
    refetch();
    if (alsoPage) onChanged();
  };
  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const data = await send(`${API}/registry`, "POST", { BookingId: detail.BookingId });
      toast.success(`${data.RegNo} started`);
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStarting(false); }
  };
  const handleSchedule = async () => {
    if (registryId == null || !date) { toast.error("Date is required"); return; }
    const re = scheduleOpen === "reschedule";
    if (!re && !office.trim()) { toast.error("Sub-Registrar Office is required"); return; }
    if (re && !reason.trim()) { toast.error("A reason is required to reschedule"); return; }
    setBusy(true);
    try {
      await send(`${API}/registry/${registryId}/${re ? "reschedule" : "schedule"}`, "PUT", re
        ? { ScheduledDate: date, AppointmentTime: time, AppointmentOffice: office, Reason: reason.trim() }
        : { ScheduledDate: date, AppointmentTime: time, AppointmentOffice: office.trim() });
      toast.success(re ? "Appointment rescheduled" : "Appointment scheduled");
      setScheduleOpen(null); setDate(""); setTime(""); setOffice(""); setReason("");
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const handleComplete = async () => {
    if (registryId == null) return;
    setBusy(true);
    try {
      await send(`${API}/registry/${registryId}/complete`, "PUT", complete);
      toast.success("Registry completed — Sale Deed marked Registered");
      setCompleteOpen(false); setComplete(EMPTY_COMPLETE());
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const handleCancel = async () => {
    if (registryId == null || !cancelReason.trim()) { toast.error("A reason is required"); return; }
    setBusy(true);
    try {
      await send(`${API}/registry/${registryId}/cancel`, "PUT", { Reason: cancelReason.trim() });
      toast.success("Registry cancelled");
      setCancelOpen(false); setCancelReason("");
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  // The document centre's upload (one file onto a requested paper, or several supporting ones).
  const uploadFiles = (files: File[], documentType: string, label?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("DocumentType", documentType);
    if (label) fd.append("Label", label);
    return send(`${API}/registry/${registryId}/documents/upload`, "POST", fd);
  };
  const handleRequest = async (documentType: string, label?: string) => {
    if (registryId == null) return;
    setRequesting(true);
    try {
      await send(`${API}/registry/${registryId}/documents/request`, "POST", { DocumentType: documentType, Label: label, IsMandatory: true });
      toast.success("Document requested");
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequesting(false); }
  };
  const fileUrl = (doc: any) => `${API}/registry/documents/file/${doc.Id}`;

  const sheetDialog = "rounded-none p-5 gap-4";
  const canAct = canEdit && !locked;

  return (
    <div className="space-y-4">
      <Panel title="Sub-Registrar office registration" right={status ? <SheetMark text={status} tone={deedTone(status)} /> : undefined}>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">Both parties appear at the Sub-Registrar Office to register the Sale Deed — this legally transfers ownership to the buyer.</p>
          <AutoStep n={1} label="Sub-Registrar appointment" done={status === "Completed"}>
            {!registry && (
              <div className="mt-1">
                {!qpConfirmed ? (
                  <p className="text-xs text-muted-foreground">Unlocks once the stamp duty payment (Query Payment tab) is confirmed.</p>
                ) : canCreate ? (
                  <button onClick={handleStart} disabled={starting || !startEligible} className={`${KEY_INK} h-8 px-3`}>
                    {starting ? "Starting…" : "Start registry"}
                  </button>
                ) : <p className="text-xs text-muted-foreground">Not started yet.</p>}
              </div>
            )}

            {registry && (
              <div className="mt-2 space-y-3">
                {status === "Pending" && (
                  <div className="px-3 py-2.5 flex items-center justify-between gap-3" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    <p className="text-xs">No appointment scheduled yet.</p>
                    {canEdit && <button onClick={() => { setScheduleOpen("first"); setDate(""); }} className={`${KEY_INK} h-8 px-3 shrink-0`}>Schedule</button>}
                  </div>
                )}
                {status === "Scheduled" && (
                  <div className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    <div>
                      <p className="text-xs font-semibold tabular-nums">Appointment: {fmtDate(registry.ScheduledDate)}{registry.AppointmentTime && ` · ${registry.AppointmentTime}`}</p>
                      {registry.AppointmentOffice && <p className="text-xs text-muted-foreground mt-0.5">{registry.AppointmentOffice}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {required.length > 0 ? `${verified}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canEdit && (
                        <button onClick={() => { setScheduleOpen("reschedule"); setDate(registry.ScheduledDate ? String(registry.ScheduledDate).slice(0, 10) : ""); setTime(registry.AppointmentTime || ""); setOffice(registry.AppointmentOffice || ""); setReason(""); }}
                          className={`${KEY_LINE} h-8 px-3`}>Reschedule</button>
                      )}
                      {canCompleteOrCancel ? (
                        <button onClick={() => { setComplete({ ...EMPTY_COMPLETE(), SubRegistrarOffice: registry.AppointmentOffice || registry.SubRegistrarOffice || "" }); setCompleteOpen(true); }}
                          disabled={required.length > 0 && verified < required.length}
                          title={required.length > 0 && verified < required.length ? "Verify every mandatory document first" : undefined}
                          className={`${KEY_INK} h-8 px-3`}>
                          Mark completed
                        </button>
                      ) : <span className="text-[0.6875rem] text-muted-foreground">Completing needs the Legal head / an admin</span>}
                    </div>
                  </div>
                )}
                {status === "Completed" && (
                  <div className="px-3 py-2.5 text-xs space-y-0.5" style={{ border: RULE, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    <p className="font-semibold tabular-nums">Registered {fmtDate(registry.RegistrationDate)}</p>
                    <p className="text-muted-foreground tabular-nums">Reg No. {registry.RegistrationNo} · Book {registry.BookNo || "—"} / Part {registry.PartNo || "—"} · {registry.SubRegistrarOffice || "—"}</p>
                    {registry.WitnessNames && <p className="text-muted-foreground">Witnesses: {registry.WitnessNames}</p>}
                    <p className="text-muted-foreground">Attendance: buyer {registry.BuyerAttended ? "present" : "absent"} · seller / builder rep {registry.SellerAttended ? "present" : "absent"}</p>
                  </div>
                )}
                {status === "Cancelled" && (
                  <div className="px-3 py-2.5 text-xs" style={{ border: "1px solid hsl(var(--destructive) / 0.4)", borderLeft: "3px solid hsl(var(--destructive))" }}>
                    <p className="font-semibold text-destructive">Registry cancelled</p>
                    {registry.CancelledReason && <p className="text-muted-foreground mt-0.5">{registry.CancelledReason}</p>}
                  </div>
                )}
                {!locked && canCompleteOrCancel && (
                  <button onClick={() => setCancelOpen(true)} className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}>Cancel registry</button>
                )}

                {(registry.DeedStampDuty || registry.DeedRegistrationFee || registry.QPConfirmedAmount) && (
                  <div className="grid grid-cols-1 sm:grid-cols-3" style={{ border: RULE }}>
                    {[
                      ["Stamp duty", registry.DeedStampDuty != null ? fmtRupees(registry.DeedStampDuty) : "—"],
                      ["Registration fee", registry.DeedRegistrationFee != null ? fmtRupees(registry.DeedRegistrationFee) : "—"],
                      ["Query payment", `${registry.QPConfirmedAmount != null ? fmtRupees(registry.QPConfirmedAmount) : "—"}${registry.QPStatus ? ` (${registry.QPStatus})` : ""}`],
                    ].map(([l, v]) => (
                      <div key={l} className="px-3 py-2" style={{ borderRight: RULE_SOFT }}>
                        <p className={LBL}>{l}</p>
                        <p className="font-heading font-semibold tabular-nums text-sm mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>
                )}

                <DocumentCentre documents={[...required, ...supporting]} hasFile={(d) => !!d.HasFile} fileUrl={fileUrl} onChanged={() => changed()}
                  requiredTitle="Registry papers"
                  review={(d, verify, remarks) => send(`${API}/registry/${registryId}/documents/${d.Id}`, "PUT", verify ? { Status: "Verified" } : { Status: "Rejected", Remarks: remarks })}
                  attach={(d, f) => uploadFiles([f], d.DocumentType, d.Label)}
                  upload={{ types: [{ value: "StampedDeedCopy", label: "Stamped deed copy" }, { value: "Other", label: "Other" }], run: uploadFiles }}
                  canAttach={{ ok: canAct, reason: "Working the registry's papers needs the registry right." }}
                  canReview={{ ok: canAct, reason: "Reviewing the registry's papers needs the registry right." }}
                  nextStep={(d) => (d.Remarks?.startsWith("Synced automatically") ? "Pulled from the sale deed's own verified copy — nothing to do here." : undefined)}
                  extraTag={(d) => (d.Remarks?.startsWith("Synced automatically") ? <span className="inline-flex items-center h-5 px-2 rounded-full border border-dashed border-border text-[0.6875rem] text-muted-foreground">Synced from sale deed</span> : null)}
                  emptyRequired={(
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground">No mandatory paper asked for yet.</p>
                      {canAct && (
                        <button type="button" onClick={() => handleRequest("RegistrationReceipt", "Registration Receipt / Challan")} disabled={requesting} className={`${KEY_INK} h-8 px-3`}>
                          {requesting ? "Requesting…" : "Request receipt"}
                        </button>
                      )}
                    </div>
                  )} />
              </div>
            )}
          </AutoStep>

          <AutoStep n={2} label="Deed registration" done={!!detail.RegistrationNo}
            status={detail.RegistrationNo ? <span className="text-xs font-heading tabular-nums">{detail.RegistrationNo}</span> : undefined}>
            {!detail.RegistrationNo ? (
              <p className="text-xs text-muted-foreground mt-1">Marked complete when the registry above is completed with its registration no.</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">Registered {fmtDate(detail.RegistrationDate)} · Book {detail.BookNo || "—"} / Part {detail.PartNo || "—"}</p>
            )}
          </AutoStep>

          <DateStep n={3} label="Index II received" isLast
            hint="Certified copy of Index II from the Sub-Registrar"
            value={detail.Index2ReceivedDate} onSave={onSaveIndex2} saving={savingIndex2} canEdit={canEditDeed} />
        </div>
      </Panel>

      {/* Schedule / reschedule */}
      <Dialog open={!!scheduleOpen} onOpenChange={(o) => !o && setScheduleOpen(null)}>
        <DialogContent className={`max-w-sm ${sheetDialog}`} style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">{scheduleOpen === "reschedule" ? "Reschedule appointment" : "Schedule registration"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>{scheduleOpen === "reschedule" ? "New date *" : "Appointment date *"}</label>
                <DateInput value={date} min={localDay()} onChange={(e) => setDate(e.target.value)} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Time</label>
                <input className={INP} value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 11:30 AM" />
              </div>
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Sub-Registrar office{scheduleOpen === "reschedule" ? "" : " *"}</label>
              <input className={INP} value={office} onChange={(e) => setOffice(e.target.value)} placeholder="e.g. Sonarpur SRO" />
            </div>
            {scheduleOpen === "reschedule" && (
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Reason *</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being rescheduled?" className={`${TEXTAREA} min-h-[70px]`} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setScheduleOpen(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleSchedule} disabled={busy} className={`${KEY_INK} h-9 px-4`}>{busy ? "Saving…" : "Save"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete */}
      <Dialog open={completeOpen} onOpenChange={(o) => !o && setCompleteOpen(false)}>
        <DialogContent className={`max-w-md max-h-[90vh] overflow-y-auto ${sheetDialog}`} style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Mark registry completed</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Registration no. *</label>
              <input className={`${INP} tabular-nums`} value={complete.RegistrationNo} onChange={(e) => setComplete((f) => ({ ...f, RegistrationNo: e.target.value }))} placeholder="e.g. 1234/2026" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Book no.</label>
                <input className={INP} value={complete.BookNo} onChange={(e) => setComplete((f) => ({ ...f, BookNo: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Part no.</label>
                <input className={INP} value={complete.PartNo} onChange={(e) => setComplete((f) => ({ ...f, PartNo: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Sub-Registrar office</label>
              <input className={INP} value={complete.SubRegistrarOffice} onChange={(e) => setComplete((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Registration date</label>
              <DateInput value={complete.RegistrationDate} max={localDay()} onChange={(e) => setComplete((f) => ({ ...f, RegistrationDate: e.target.value }))} className={INP} />
            </div>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>Witness names *</label>
              <input className={INP} value={complete.WitnessNames} onChange={(e) => setComplete((f) => ({ ...f, WitnessNames: e.target.value }))} placeholder="e.g. Ramesh Das, Sunita Roy" />
              <p className="text-[0.6875rem] text-muted-foreground">The Registration Act requires two identifying witnesses at the office.</p>
            </div>
            <div className="p-3 space-y-2" style={{ border: RULE_SOFT }}>
              <p className={LBL}>Attendance confirmation *</p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-foreground" checked={complete.BuyerAttended} onChange={(e) => setComplete((f) => ({ ...f, BuyerAttended: e.target.checked }))} />
                Buyer (or authorised POA holder) was present
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-foreground" checked={complete.SellerAttended} onChange={(e) => setComplete((f) => ({ ...f, SellerAttended: e.target.checked }))} />
                Seller / builder representative was present
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setCompleteOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleComplete}
              disabled={busy || !complete.RegistrationNo.trim() || !complete.WitnessNames.trim() || !complete.BuyerAttended || !complete.SellerAttended}
              className={`${KEY_INK} h-9 px-4`}>
              {busy ? "Saving…" : "Confirm completed"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={cancelOpen} onOpenChange={(o) => !o && setCancelOpen(false)}>
        <DialogContent className={`max-w-sm ${sheetDialog}`} style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Cancel registry</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <label className={`block ${LBL}`}>Reason *</label>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={`${TEXTAREA} min-h-[80px]`} />
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setCancelOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Back</button>
            <button onClick={handleCancel} disabled={busy || !cancelReason.trim()} className={`${KEY_RED} h-9 px-4`}>{busy ? "Cancelling…" : "Cancel registry"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
