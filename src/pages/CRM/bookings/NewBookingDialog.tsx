// New Booking: the manual fallback when an approved Application has no booking yet. Everything the Application
// already captured (unit, rate, token, plan, booking amount, payment mode, assignee, brokerage, notes) is fetched
// and locked; staff only pick a unit when the Application's own is no longer available.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { DateInput } from "@/components/ui/date-input";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import {
  API, EMPTY_FORM, KEY_INK, KEY_LINE, PAY_MODES, RULE, RULE_SOFT, TOKEN_TYPES, fetchApps, fetchPaymentPlans, fetchPlots, fetchUnits, fetchUsers,
  inputCls, inputClsDisabled, labelCls, type BookingForm,
} from "./config";

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-card" style={{ border: RULE }}>
    <p className="px-3 py-2 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground" style={{ borderBottom: RULE }}>{title}</p>
    <div className="p-3 space-y-2.5">{children}</div>
  </section>
);

export function NewBookingDialog({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<BookingForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: apps = [], isLoading: loadingApps } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: units = [], isLoading: loadingUnits } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: plots = [], isLoading: loadingPlots } = useQuery({ queryKey: ["plot-master"], queryFn: fetchPlots, staleTime: 5 * 60_000 });
  const { data: paymentPlans = [] } = useQuery({ queryKey: ["crm-payment-plans-active"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });

  // The plan tagged to this booking (via the Application): its BookingAmount is the fixed figure.
  const selectedPlan = useMemo(
    () => (paymentPlans as any[]).find((p: any) => String(p.Id) === form.PaymentPlanId) || null,
    [paymentPlans, form.PaymentPlanId],
  );
  useEffect(() => {
    if (selectedPlan?.BookingAmount == null) return;
    const planAmt = String(selectedPlan.BookingAmount);
    setForm((f) => (f.BookingAmount === planAmt ? f : { ...f, BookingAmount: planAmt }));
  }, [selectedPlan]);

  // unit-master's own LockBookingNo/LockHoldId (system-wide) is the source of "available".
  const availableUnits = useMemo(
    () => (units as any[]).filter((u: any) => u.IsActive && (!(u.LockBookingNo || u.LockHoldId) || form.UnitIds.includes(String(u.Id)))),
    [units, form.UnitIds],
  );
  const availablePlots = useMemo(
    () => (plots as any[]).filter((p: any) => !(p.LockBookingNo || p.LockApplicationNo || p.LockHoldId) || form.PlotIds.includes(String(p.Id))),
    [plots, form.PlotIds],
  );

  // The Application's own unit(s) are locked in only while still available: two Applications can share a preferred
  // unit, and if another one booked it this dialog must let staff pick a replacement.
  const selectedApp = useMemo(() => (apps as any[]).find((a: any) => String(a.Id) === form.ApplicationId), [apps, form.ApplicationId]);
  const appPreferredUnitId: number | undefined = selectedApp?.PreferredUnitId;
  const appPreferredUnitIds = useMemo(() => {
    const primary = selectedApp?.PreferredUnitId != null ? String(selectedApp.PreferredUnitId) : null;
    const saved = String(selectedApp?.PreferredUnitIdsCsv || "").split(",").filter(Boolean);
    return primary ? [primary, ...saved.filter((id) => id !== primary)] : saved;
  }, [selectedApp]);
  const appPreferredUnitAvailable = appPreferredUnitIds.length > 0
    && appPreferredUnitIds.every((id) => (availableUnits as any[]).some((u: any) => String(u.Id) === id));
  const unitLockedFromApp = appPreferredUnitIds.length > 0 && appPreferredUnitAvailable;
  const appPreferredPlotIds = useMemo(() => String(selectedApp?.PreferredPlotIdsCsv || "").split(",").filter(Boolean), [selectedApp]);
  const appPreferredPlotsAvailable = appPreferredPlotIds.length > 0
    && appPreferredPlotIds.every((id) => (availablePlots as any[]).some((p: any) => String(p.Id) === id));
  const plotLockedFromApp = appPreferredPlotIds.length > 0 && appPreferredPlotsAvailable;

  const handleApplicationSelect = (id: string) => {
    const app = (apps as any[]).find((a: any) => String(a.Id) === id);
    const plotIds = String(app?.PreferredPlotIdsCsv || "").split(",").filter(Boolean);
    const appPlots = (plots as any[]).filter((p: any) => plotIds.includes(String(p.Id)));
    const primaryId = app?.PreferredUnitId != null ? String(app.PreferredUnitId) : null;
    const savedIds = String(app?.PreferredUnitIdsCsv || "").split(",").filter(Boolean);
    const unitIds = primaryId ? [primaryId, ...savedIds.filter((x) => x !== primaryId)] : savedIds;
    const appUnits = (units as any[]).filter((u: any) => unitIds.includes(String(u.Id)));
    const appUnit = appUnits.find((u: any) => String(u.Id) === primaryId) || appUnits[0] || null;
    const isPlotApplication = plotIds.length > 0;
    const selectedAssets = isPlotApplication ? appPlots : appUnits;
    const primaryAsset = isPlotApplication ? appPlots[0] : appUnit;
    const combinedArea = selectedAssets.reduce((total: number, asset: any) => total + (parseFloat(asset.AreaSqFt) || 0), 0);
    const area = combinedArea > 0 ? String(combinedArea) : "";
    const rate = app?.RatePerSqFt != null ? String(app.RatePerSqFt) : "";
    const areaNum = parseFloat(area);
    const rateNum = parseFloat(rate);
    setForm((f) => ({
      ...f,
      ApplicationId: id,
      UnitIds: isPlotApplication ? [] : unitIds,
      PlotIds: isPlotApplication ? plotIds : [],
      UnitNo: selectedAssets.map((asset: any) => asset.PlotName || asset.UnitName).join(", ") || "",
      ProjectName: primaryAsset?.ProjectName || "",
      BlockName: primaryAsset?.BlockName || "",
      UnitType: isPlotApplication ? "Plot" : (appUnit?.UnitType || ""),
      AreaSqFt: area,
      RatePerSqFt: rate,
      TotalValue: !isNaN(areaNum) && !isNaN(rateNum) ? String(Math.round(areaNum * rateNum)) : "",
      PaymentPlanId: app?.PaymentPlanId ? String(app.PaymentPlanId) : "",
      TokenType: app?.TokenType || "Percentage",
      TokenValue: app?.TokenValue != null ? String(app.TokenValue) : "",
      BookingAmount: app?.BookingAmount != null ? String(app.BookingAmount) : "",
      PaymentMode: app?.PaymentMode || "",
      AssignedTo: app?.AssignedTo != null ? String(app.AssignedTo) : "",
      Notes: app?.Notes || "",
      BrokerId: app?.BrokerId != null ? String(app.BrokerId) : "",
      BrokerageRatePercent: app?.BrokerageRatePercent != null ? String(app.BrokerageRatePercent) : "",
      BrokerageSplitEnabled: !!app?.BrokerageSplitEnabled,
    }));
  };

  // Opened with ?applicationId=: fill everything in from that Application once the lists are in (it used to set only
  // the id, leaving unit, rate and plan empty).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!applicationId || prefilled.current || loadingApps || loadingUnits || loadingPlots) return;
    prefilled.current = true;
    if ((apps as any[]).some((a: any) => String(a.Id) === applicationId)) handleApplicationSelect(applicationId);
  }, [applicationId, loadingApps, loadingUnits, loadingPlots]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnitsChange = (nextIds: string[]) => {
    const selectedUnits = (units as any[]).filter((u: any) => nextIds.includes(String(u.Id)));
    const primary = selectedUnits[0] || null;
    const combinedArea = selectedUnits.reduce((acc, u) => acc + (parseFloat(u.AreaSqFt) || 0), 0);
    const rate = parseFloat(form.RatePerSqFt);
    setForm((f) => ({
      ...f,
      UnitIds: nextIds,
      PlotIds: [],
      UnitNo: selectedUnits.map((u: any) => u.UnitName).join(", ") || f.UnitNo,
      ProjectName: primary?.ProjectName || f.ProjectName,
      BlockName: primary?.BlockName || f.BlockName,
      UnitType: primary?.UnitType || "",
      AreaSqFt: combinedArea > 0 ? String(combinedArea) : "",
      TotalValue: combinedArea > 0 && !isNaN(rate) ? String(Math.round(combinedArea * rate)) : (nextIds.length === 0 ? "" : f.TotalValue),
    }));
  };

  const handlePlotsChange = (nextIds: string[]) => {
    const selectedPlots = (plots as any[]).filter((p: any) => nextIds.includes(String(p.Id)));
    const primary = selectedPlots[0] || null;
    const combinedArea = selectedPlots.reduce((acc, p) => acc + (parseFloat(p.AreaSqFt) || 0), 0);
    const rate = parseFloat(form.RatePerSqFt);
    setForm((f) => ({
      ...f,
      UnitIds: [],
      PlotIds: nextIds,
      UnitNo: selectedPlots.map((p: any) => p.PlotName).join(", ") || f.UnitNo,
      ProjectName: primary?.ProjectName || f.ProjectName,
      BlockName: primary?.BlockName || f.BlockName,
      UnitType: "Plot",
      AreaSqFt: combinedArea > 0 ? String(combinedArea) : "",
      TotalValue: combinedArea > 0 && !isNaN(rate) ? String(Math.round(combinedArea * rate)) : (nextIds.length === 0 ? "" : f.TotalValue),
    }));
  };

  // Rate applies to the single agreed (inclusive saleable) area from Unit Master.
  const handleRateChange = (val: string) => {
    const rate = parseFloat(val);
    const area = parseFloat(form.AreaSqFt);
    setForm((f) => ({ ...f, RatePerSqFt: val, TotalValue: !isNaN(area) && !isNaN(rate) ? String(Math.round(area * rate)) : f.TotalValue }));
  };

  const isPlotBooking = form.PlotIds.length > 0 || appPreferredPlotIds.length > 0;

  const handleSave = async () => {
    if (!form.ApplicationId) return void toast.error("Select an application.");
    if (form.UnitIds.length === 0 && form.PlotIds.length === 0) return void toast.error("Select at least one unit or plot.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ApplicationId: parseInt(form.ApplicationId),
          UnitIds: form.UnitIds.map((id) => parseInt(id)),
          PlotIds: form.PlotIds.map((id) => parseInt(id)),
          AreaSqFt: form.AreaSqFt || null,
          RatePerSqFt: form.RatePerSqFt || null,
          TotalValue: form.TotalValue || null,
          TokenValue: form.TokenValue || null,
          PaymentPlanId: isPlotBooking ? null : (form.PaymentPlanId || null),
          AssignedTo: form.AssignedTo || null,
          BookingAmount: form.BookingAmount || null,
          BrokerId: form.BrokerId || null,
          BrokerageRatePercent: form.BrokerageRatePercent || null,
          BrokeragePaymentPlan: form.BrokerId ? (form.BrokeragePaymentPlan || "OneTime") : "OneTime",
          // No deposit bank from CRM: Accounts assigns it on the Received Payment before approval.
          DepositBankId: null,
          DepositBankName: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the booking.");
      toast.success(`Booking ${data.BookingNo} created; payment milestones generated`);
      if (data.tokenWarning) toast.warning(data.tokenWarning, { duration: 8000 });
      // The Application just became Converted: the application list must drop it at once.
      ["crm-bookings", "crm-apps", "unit-master", "plot-master"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const ro = (v: string) => <input type="text" value={v} readOnly disabled placeholder="Filled from the application" className={inputClsDisabled} />;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-5 gap-3 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
            <Building2 size={14} /> New booking
          </DialogTitle>
        </DialogHeader>

        <div>
          <label className={labelCls}>Application * (approved, not yet booked)</label>
          <Select value={form.ApplicationId || undefined} onValueChange={handleApplicationSelect}>
            <SelectTrigger className={`${inputCls} rounded-none`}>
              <SelectValue placeholder={loadingApps ? "Loading applications…" : (apps as any[]).length ? "Select application" : "No approved application is waiting for a booking"} />
            </SelectTrigger>
            <SelectContent>
              {(apps as any[]).map((a: any) => (
                <SelectItem key={a.Id} value={String(a.Id)}>
                  {a.ApplicationNo} · <ApplicantNames name={a.ApplicantName} applicationId={a.Id} /> ({a.Mobile})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title={isPlotBooking ? "Plot / project" : "Unit / project"}>
            <div>
              <label className={labelCls}>
                {isPlotBooking ? "Plot" : "Unit"} * {(unitLockedFromApp || plotLockedFromApp) ? "(from the application)" : `(from ${isPlotBooking ? "Plot" : "Unit"} Master)`}
              </label>
              {(unitLockedFromApp || plotLockedFromApp) ? (
                ro(`${form.ProjectName} · ${form.BlockName} · ${form.UnitNo}`)
              ) : (
                <>
                  {isPlotBooking ? (
                    <MultiSelectDropdown
                      options={(availablePlots as any[]).map((p: any) => ({ id: String(p.Id), label: `${p.ProjectName} · ${p.BlockName} · ${p.PlotName}`, group: p.BlockName }))}
                      value={form.PlotIds}
                      onChange={handlePlotsChange}
                      placeholder="Select plots"
                      searchPlaceholder="Search plots..."
                      itemNoun="plot"
                    />
                  ) : (
                    <Select value={form.UnitIds[0] || undefined} onValueChange={(id) => handleUnitsChange([id])}>
                      <SelectTrigger className={`${inputCls} rounded-none`}>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent className="max-w-[min(90vw,420px)]">
                        {(availableUnits as any[]).map((u: any) => (
                          <SelectItem key={u.Id} value={String(u.Id)}>{u.ProjectName} · {u.BlockName} · {u.UnitName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {appPreferredUnitId != null && !appPreferredUnitAvailable && (
                    <p className="text-[0.6875rem] text-destructive mt-1">The application's unit is no longer available; pick another.</p>
                  )}
                  {appPreferredPlotIds.length > 0 && !appPreferredPlotsAvailable && (
                    <p className="text-[0.6875rem] text-destructive mt-1">The application's plot is no longer available; pick another.</p>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div><label className={labelCls}>Project</label>{ro(form.ProjectName)}</div>
              <div><label className={labelCls}>Block / tower</label>{ro(form.BlockName)}</div>
              <div><label className={labelCls}>Type</label>{ro(form.UnitType)}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div><label className={labelCls}>Saleable area (sq ft)</label>{ro(form.AreaSqFt)}</div>
              <div>
                <label className={labelCls}>Rate / sq ft (₹)</label>
                <input type="number" value={form.RatePerSqFt} onChange={(e) => handleRateChange(e.target.value)}
                  disabled={!!form.ApplicationId && !!form.RatePerSqFt}
                  className={form.ApplicationId && form.RatePerSqFt ? inputClsDisabled : inputCls} />
              </div>
              <div>
                <label className={labelCls}>Total value (₹)</label>
                <input type="number" value={form.TotalValue} onChange={(e) => setForm((f) => ({ ...f, TotalValue: e.target.value }))}
                  className={`${inputCls} font-semibold tabular-nums`} />
              </div>
            </div>
            {form.TotalValue && (
              <p className="px-3 py-2 text-[0.6875rem] text-muted-foreground" style={{ border: RULE_SOFT }}>
                The payment milestones are generated from ₹{Number(form.TotalValue).toLocaleString("en-IN")} {isPlotBooking ? "(booking amount, then the balance)" : "by the payment plan"}.
              </p>
            )}
          </Panel>

          <Panel title="Booking and payment">
            <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_0.9fr] gap-2.5">
              <div>
                <label className={labelCls}>Booking date</label>
                <DateInput value={form.BookingDate} onChange={(e) => setForm((f) => ({ ...f, BookingDate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Token type</label>
                {form.ApplicationId ? ro(form.TokenType) : (
                  <Select value={form.TokenType} onValueChange={(v) => setForm((f) => ({ ...f, TokenType: v }))}>
                    <SelectTrigger className={`${inputCls} rounded-none`}><SelectValue /></SelectTrigger>
                    <SelectContent>{TOKEN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className={labelCls}>Token {form.TokenType === "Percentage" ? "(%)" : "(₹)"}</label>
                <input type="number" value={form.TokenValue} onChange={(e) => setForm((f) => ({ ...f, TokenValue: e.target.value }))}
                  disabled={!!form.ApplicationId && !!form.TokenValue}
                  className={form.ApplicationId && form.TokenValue ? inputClsDisabled : inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{isPlotBooking ? "Payment schedule" : "Payment plan (from the application)"}</label>
              {ro(isPlotBooking ? "No payment plan: booking amount, then the balance" : (selectedPlan?.PlanName || selectedApp?.PaymentPlanName || "Default 7-stage split"))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className={labelCls}>Payment mode</label>
                {form.ApplicationId && form.PaymentMode ? ro(form.PaymentMode) : (
                  <Select value={form.PaymentMode || undefined} onValueChange={(v) => setForm((f) => ({ ...f, PaymentMode: v }))}>
                    <SelectTrigger className={`${inputCls} rounded-none`}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className={labelCls}>Deposited to</label>
                <p className="text-[0.6875rem] text-muted-foreground pt-2">Assigned by Accounts on the Received Payment before approval.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className={labelCls}>Booking amount (₹) {!isPlotBooking && selectedPlan ? "(plan)" : ""}</label>
                {/* A plot sale has no plan: the amount typed here is the Booking milestone, the rest the Balance. */}
                <input type="number" value={form.BookingAmount} onChange={(e) => setForm((f) => ({ ...f, BookingAmount: e.target.value }))}
                  disabled={!isPlotBooking && !!selectedPlan}
                  placeholder={isPlotBooking ? "Empty for one full payment" : selectedPlan ? undefined : "From the payment plan"}
                  className={!isPlotBooking && selectedPlan ? inputClsDisabled : inputCls} />
              </div>
              <div>
                <label className={labelCls}>Assigned to</label>
                {form.ApplicationId && form.AssignedTo ? ro(users.find((u) => u.value === form.AssignedTo)?.label || "Assigned on the application") : (
                  <Select value={form.AssignedTo || undefined} onValueChange={(v) => setForm((f) => ({ ...f, AssignedTo: v }))}>
                    <SelectTrigger className={`${inputCls} rounded-none`}><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>{users.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div>
          <label className={labelCls}>Notes {form.ApplicationId && form.Notes ? "(from the application; add to it if needed)" : ""}</label>
          <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} rows={2}
            className={`${inputCls} h-auto py-2 resize-none`} />
        </div>

        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Creating…" : "Create booking"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
