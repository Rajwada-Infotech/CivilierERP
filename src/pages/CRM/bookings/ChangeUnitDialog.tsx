// Change Unit: raise a request to move the buyer from this booking's unit to another unit, in this project or another
// one. The request carries the new unit, its rate and plan, and for each parking slot and extra charge whether it
// stays the same or is changed. On approval (Approval Setup: CRM Unit Change) the old booking closes, a new booking
// opens on the new unit and every rupee received moves to it in full. The server previews and checks every rule.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Repeat } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { GridDialog, GridFormField, GridFormSection, GRID_BTN, GRID_BTN_BRAND, GRID_INPUT } from "@/components/crm/CrmDataTable";
import { API, fetchUnits, fmt } from "./config";

export function ChangeUnitDialog({ booking, onClose }: { booking: any; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(String(booking.ProjectId ?? ""));
  const [unitId, setUnitId] = useState("");
  const [rate, setRate] = useState("");
  const [planId, setPlanId] = useState("");
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: units = [], isLoading: unitsLoading } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const keepParam = Object.entries(keep).filter(([, v]) => v).map(([k]) => k).sort().join(",");
  const { data: o, isFetching, error } = useQuery({
    queryKey: ["crm-unit-change-options", booking.Id, unitId, rate, planId, keepParam],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (unitId) q.set("unitId", unitId);
      if (rate) q.set("rate", rate);
      if (planId) q.set("planId", planId);
      if (keepParam) q.set("keep", keepParam);
      const res = await fetchWithAuth(`${API}/${booking.Id}/unit-change-options?${q}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load the unit change details");
      return d;
    },
    placeholderData: (prev) => prev,
  });
  // A new unit starts at its own rate (the rate can be changed before sending).
  useEffect(() => { if (o?.next?.unitId === Number(unitId) && rate === "" && o.next.ratePerSqFt) setRate(String(o.next.ratePerSqFt)); }, [o, unitId, rate]);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    if (booking.ProjectId != null) m.set(String(booking.ProjectId), booking.ProjectName || `Project ${booking.ProjectId}`);
    (units as any[]).filter((u) => u.IsActive && u.ProjectId != null).forEach((u) => m.set(String(u.ProjectId), u.ProjectName || `Project ${u.ProjectId}`));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [units, booking.ProjectId, booking.ProjectName]);
  const unitOptions = useMemo(() => (units as any[])
    .filter((u) => u.IsActive && Number(u.Id) !== Number(booking.UnitId) && !(u.LockBookingNo || u.LockHoldId) && String(u.ProjectId ?? "") === projectId)
    .map((u) => ({ value: String(u.Id), label: [u.BlockName, u.UnitName, u.UnitType].filter(Boolean).join(" · ") })), [units, booking.UnitId, projectId]);

  const addOns: any[] = o?.addOns ?? [];
  const key = (a: any) => `${a.kind}:${a.id}`;
  const choice = (a: any) => (a.canKeep ? keep[key(a)] : false);
  // The server prices the new booking with GST (the same quote as the application form) and compares it with all the
  // money received, GST included.
  const newPrice = o?.next?.grandTotal != null ? Number(o.next.grandTotal) : null;
  const receivedNow = Number(o?.money?.Received || 0);
  const balance = o?.next?.balance != null ? Number(o.next.balance) : null;
  const blockers: string[] = unitId ? o?.blockers ?? [] : (o?.blockers ?? []).filter((b: string) => !/new unit/i.test(b));
  const plans: any[] = o?.plans ?? [];
  const needsPlan = !!unitId && plans.length > 1 && !planId && !o?.planId;
  const undecided = addOns.some((a) => a.canKeep && keep[key(a)] === undefined);

  const send = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.Id}/unit-change`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          TargetUnitId: Number(unitId), RatePerSqFt: rate || undefined, PaymentPlanId: planId || o?.planId || undefined, Reason: reason.trim(),
          AddOns: addOns.map((a) => ({ kind: a.kind, id: a.id, keep: choice(a) === true })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not raise the unit change");
      toast.success(d.message);
      ["crm-bookings", "crm-unit-changes", "unit-master"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
      navigate(`/crm/unit-changes?id=${d.id}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const canSend = !!unitId && !!reason.trim() && !blockers.length && !needsPlan && !undecided && !isFetching && !saving;

  return (
    <GridDialog onClose={onClose} icon={Repeat} width="max-w-3xl" title="Change Unit"
      description={`${booking.BookingNo} · now ${[booking.ProjectName, booking.BlockName, booking.UnitNo].filter(Boolean).join(" · ")}`}
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button>
        <button type="button" onClick={send} disabled={!canSend} className={GRID_BTN_BRAND}>{saving ? "Sending…" : "Send for Approval"}</button></>}>
      <p className="mb-3 text-sm text-muted-foreground">On approval this booking closes, a new booking opens on the new unit for the same buyer, and every rupee received moves to it, with no charge.</p>
      {error && <p className="mb-3 text-sm text-destructive">{translateError((error as Error).message)}</p>}
      {blockers.length > 0 && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive space-y-1">{blockers.map((b) => <p key={b}>{b}</p>)}</div>}
      <GridFormSection>
        <GridFormField label="Project" required>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setUnitId(""); setRate(""); setPlanId(""); setKeep({}); }} className={GRID_INPUT}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === String(booking.ProjectId ?? "") ? " (this project)" : ""}</option>)}
          </select>
        </GridFormField>
        <GridFormField label="New unit" required>
          <SearchableSelect value={unitId} onChange={(v) => { setUnitId(v); setRate(""); setPlanId(""); }}
            placeholder={unitsLoading ? "Loading units…" : unitOptions.length ? "Select the new unit" : "No free unit in this project"}
            searchPlaceholder="Search block or unit…" options={unitOptions} />
        </GridFormField>
        {unitId && <GridFormField label="Rate per sq ft" required hint={o?.next?.unitRate ? `Unit rate ${Number(o.next.unitRate).toLocaleString("en-IN")}` : undefined}>
          <input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={cn(GRID_INPUT, "tabular-nums")} />
        </GridFormField>}
        {unitId && plans.length > 1 && <GridFormField label="Payment plan" required>
          <select value={planId || (o?.planId ? String(o.planId) : "")} onChange={(e) => setPlanId(e.target.value)} className={GRID_INPUT}>
            <option value="">Select the payment plan</option>
            {plans.map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.PlanName} · booking amount {fmt(Number(p.BookingAmount || 0))}</option>)}
          </select>
        </GridFormField>}
        {unitId && plans.length === 1 && <GridFormField label="Payment plan"><div className={cn(GRID_INPUT, "flex items-center text-muted-foreground")}>{plans[0].PlanName}</div></GridFormField>}

        {addOns.length > 0 && <GridFormField label="Parking and extra charges" required wide>
          <div className="divide-y divide-border rounded-md border border-border">
            {addOns.map((a) => (
              <div key={key(a)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0"><span className="font-medium">{a.kind === "Parking" ? "Parking" : "Extra charge"} · {a.label}</span> <span className="tabular-nums text-muted-foreground">{fmt(a.amount)}</span></span>
                {a.canKeep ? (
                  <span className="inline-flex gap-3">
                    <label className="inline-flex items-center gap-1.5"><input type="radio" name={key(a)} checked={keep[key(a)] === true} onChange={() => setKeep((k) => ({ ...k, [key(a)]: true }))} /> Stays the same</label>
                    <label className="inline-flex items-center gap-1.5"><input type="radio" name={key(a)} checked={keep[key(a)] === false} onChange={() => setKeep((k) => ({ ...k, [key(a)]: false }))} /> Change it</label>
                  </span>
                ) : <span className="text-xs text-muted-foreground">In the old project: chosen again on the new booking</span>}
              </div>
            ))}
          </div>
        </GridFormField>}

        {unitId && o?.next && <GridFormField label="Money" wide>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border border-border px-3 py-2 text-sm sm:grid-cols-2">
            <span className="flex justify-between gap-3"><span className="text-muted-foreground">Old price (incl. GST)</span><span className="tabular-nums">{fmt(o.current.grandTotal)}</span></span>
            <span className="flex justify-between gap-3"><span className="text-muted-foreground">New price (incl. GST)</span><span className="tabular-nums font-semibold">{newPrice != null ? fmt(newPrice) : "—"}</span></span>
            <span className="flex justify-between gap-3"><span className="text-muted-foreground">Received (moves in full)</span><span className="tabular-nums font-semibold">{fmt(receivedNow)}</span></span>
            <span className="flex justify-between gap-3"><span className="text-muted-foreground">{balance != null && balance < 0 ? "Extra, stays as the buyer's credit" : "Left to pay on the new booking"}</span><span className="tabular-nums">{balance != null ? fmt(Math.abs(balance)) : "—"}</span></span>
            {Number(o.money.WithFinance) > 0 && <span className="flex justify-between gap-3 sm:col-span-2"><span className="text-muted-foreground">With Finance (moves once verified)</span><span className="tabular-nums">{fmt(o.money.WithFinance)}</span></span>}
            {Number(o.money.NotSentToFinance) > 0 && <span className="flex justify-between gap-3 sm:col-span-2"><span className="text-muted-foreground">Receipts not sent to Finance (move to the new booking)</span><span className="tabular-nums">{fmt(o.money.NotSentToFinance)}</span></span>}
            {o.next.isCrossCompany && <span className="sm:col-span-2 text-xs text-muted-foreground">The new unit belongs to another company: the money moves through a Fund Transfer that Finance approves.</span>}
          </div>
        </GridFormField>}

        {unitId && (o?.invoices ?? []).length > 0 && <GridFormField label="Invoices of this booking" wide>
          <div className="rounded-md border border-border px-3 py-2 text-sm space-y-1">
            <p className="text-xs text-muted-foreground">Each is cancelled with a credit note on approval; the new booking issues its own invoices.</p>
            {(o.invoices as any[]).map((i) => (
              <span key={i.invoiceNo} className="flex justify-between gap-3">
                <span>{i.invoiceNo} <span className="text-muted-foreground">· {i.type}</span>{i.timeBarred && <span className="text-destructive"> · past the credit note deadline ({i.deadline})</span>}</span>
                <span className="tabular-nums">{fmt(i.amount)}</span>
              </span>
            ))}
          </div>
        </GridFormField>}

        <GridFormField label="Reason" required wide>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why the buyer is changing the unit" className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
        </GridFormField>
      </GridFormSection>
    </GridDialog>
  );
}
