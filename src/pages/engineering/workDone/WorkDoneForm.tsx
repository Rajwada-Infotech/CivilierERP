// New / edit Work Done: the document, the work order it certifies against, and how much work was done.
import React, { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { DateInput } from "@/components/ui/date-input";
import { DocNumberPreview } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import {
  type DropdownOption,
  type FormState,
  type WoActivity,
  type WoSummary,
  type WorkDoneEntry,
  type WorkOrderOption,
  Block,
  EMPTY_FORM,
  Field,
  INP,
  KEY_INK,
  KEY_LINE,
  LBL,
  RULE,
  TEXTAREA,
  fmt,
  recordToForm,
} from "./config";

export function WorkDoneForm({
  record,
  onClose,
  companies,
  projects,
  suppliers,
  workOrders,
  finYearOptions,
  loadingDropdowns,
  activeFinYear,
}: {
  record: WorkDoneEntry | null;
  onClose: () => void;
  companies: DropdownOption[];
  projects: DropdownOption[];
  suppliers: DropdownOption[];
  workOrders: WorkOrderOption[];
  finYearOptions: { id: string; year: string }[];
  loadingDropdowns: boolean;
  activeFinYear: string;
}) {
  const qc = useQueryClient();
  const isEdit = !!record;
  const [form, setForm] = useState<FormState>(record ? recordToForm(record, activeFinYear) : EMPTY_FORM(activeFinYear));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);
  const [woLoading, setWoLoading] = useState(false);
  const [woSummary, setWoSummary] = useState<WoSummary | null>(null);
  const [woActivities, setWoActivities] = useState<WoActivity[]>([]);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((prev) => ({ ...prev, [k]: v })), []);

  // The work order's figures and lines. `fill` also copies its company / project / supplier and a starting
  // unit and rate onto the form (a new pick); an entry being edited keeps what it has.
  const loadWorkOrder = useCallback(async (woId: string, fill: boolean) => {
    setWoActivities([]);
    setWoSummary(null);
    if (!woId) return;
    setWoLoading(true);
    try {
      const [sumRes, actRes] = await Promise.all([
        fetchWithAuth(`/api/engineering/work-order-summary/${woId}`),
        fetchWithAuth(`/api/work-orders/${woId}/activities?_t=${Date.now()}`),
      ]);
      const s = sumRes.ok ? await sumRes.json() : null;
      const acts: WoActivity[] = actRes.ok ? await actRes.json().then((a) => (Array.isArray(a) ? a : [])) : [];
      if (s) {
        setWoSummary({
          ContractValue: parseFloat(s.ContractValue || 0),
          totalCertified: parseFloat(s.totalCertified || 0),
          totalBooked: parseFloat(s.totalBooked || 0),
          totalPaid: parseFloat(s.totalPaid || 0),
        });
      }
      setWoActivities(acts);
      if (fill) {
        const one = acts.length === 1 ? acts[0] : null;
        setForm((prev) => ({
          ...prev,
          companyId: s?.CompanyId ? String(s.CompanyId) : prev.companyId,
          projectId: s?.ProjectId ? String(s.ProjectId) : prev.projectId,
          supplierId: s?.SupplierId ? String(s.SupplierId) : prev.supplierId,
          // One activity: measured in its unit at its rate. Several: a lump sum for the period.
          Unit: one?.UOMName || (acts.length > 1 ? "LS" : prev.Unit),
          RatePerUnit: one?.Rate != null ? String(one.Rate) : prev.RatePerUnit,
          QuantityDone: acts.length > 1 ? "1" : prev.QuantityDone,
        }));
      }
    } catch {
      toast.error("Could not load the work order's figures.");
    } finally {
      setWoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (record?.WorkOrderID) void loadWorkOrder(String(record.WorkOrderID), false);
  }, [record, loadWorkOrder]);

  const gross = (parseFloat(form.QuantityDone) || 0) * (parseFloat(form.RatePerUnit) || 0);
  const deductions = parseFloat(form.Deductions) || 0;
  const certified = gross - deductions;
  const leftToCertify = woSummary ? woSummary.ContractValue - woSummary.totalCertified + (isEdit && record?.Status === "Approved" ? record.CertifiedAmount : 0) : null;

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.DescriptionOfWork.trim()) e.DescriptionOfWork = true;
    if (!(gross > 0)) e.amount = true;
    setErrors(e);
    if (e.amount && Object.keys(e).length === 1) toast.error("Enter the quantity done and its rate.");
    else if (Object.keys(e).length) toast.error("Please fill in all required fields.");
    if (!Object.keys(e).length && form.PeriodFrom && form.PeriodTo && form.PeriodTo < form.PeriodFrom) {
      toast.error("The period ends before it starts.");
      return false;
    }
    if (!Object.keys(e).length && certified < 0) {
      toast.error("Deductions are more than the gross amount.");
      return false;
    }
    return Object.keys(e).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        CompanyId: parseInt(form.companyId) || null,
        ProjectId: parseInt(form.projectId) || null,
        FinYear: form.finYear,
        DocTypeId: form.docTypeId,
        DocNo: form.docNo,
        DocDate: form.docDate,
        SupplierId: parseInt(form.supplierId) || null,
        WorkOrderID: parseInt(form.workOrderId) || null,
        Remarks: form.remarks,
        PeriodFrom: form.PeriodFrom,
        PeriodTo: form.PeriodTo,
        DescriptionOfWork: form.DescriptionOfWork,
        QuantityDone: parseFloat(form.QuantityDone) || 0,
        Unit: form.Unit,
        RatePerUnit: parseFloat(form.RatePerUnit) || 0,
        Deductions: deductions,
        GrossAmount: gross,
        CertifiedAmount: certified,
        Status: form.Status,
      };
      const res = await fetchWithAuth(isEdit ? `/api/engineering/work-done/${record!.ID}` : "/api/engineering/work-done", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Save failed");
      return body;
    },
    onSuccess: (body: { message?: string }) => {
      qc.invalidateQueries({ queryKey: ["engineering-work-done"] });
      qc.invalidateQueries({ queryKey: ["engineering-dashboard"] });
      toast.success(body?.message || (isEdit ? "Work Done updated" : "Work Done entry created"));
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || "Save failed"),
  });

  const handleReset = () => {
    setForm(record ? recordToForm(record, activeFinYear) : EMPTY_FORM(activeFinYear));
    setErrors({});
    setDocRefreshTrigger((n) => n + 1);
    if (!record) {
      setWoSummary(null);
      setWoActivities([]);
    }
  };

  const pickable = workOrders.filter(
    (w) => (!form.companyId || !w.companyId || String(w.companyId) === form.companyId) && (!form.projectId || !w.projectId || String(w.projectId) === form.projectId),
  );
  const projectOptions = form.companyId ? projects.filter((p) => !p.company_id || projectBelongsToCompany(p as any, form.companyId)) : projects;
  const sum = (k: "LabourAmount" | "MaterialAmount" | "GrandTotal") => woActivities.reduce((s, a) => s + (a[k] ?? 0), 0);
  const skel = <div className="w-full h-10 border border-foreground/20 bg-muted/30 animate-pulse" />;

  return (
    <div className="space-y-5">
      <Block title="Document">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Field label="Company" required error={errors.companyId}>
            {loadingDropdowns ? skel : (
              <select
                value={form.companyId}
                onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "" }))}
                className={`${INP} ${errors.companyId ? "border-destructive" : ""}`}
              >
                <option value="">Select company…</option>
                {companies.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Project" required error={errors.projectId}>
            {loadingDropdowns ? skel : (
              <select
                value={form.projectId}
                onChange={(e) => setField("projectId", e.target.value)}
                disabled={!form.companyId}
                className={`${INP} ${errors.projectId ? "border-destructive" : ""}`}
              >
                <option value="">{form.companyId ? "Select project…" : "Select a company first"}</option>
                {projectOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Financial year">
            {loadingDropdowns ? skel : (
              <select
                value={form.finYear}
                onChange={(e) => {
                  setField("finYear", e.target.value);
                  setDocRefreshTrigger((n) => n + 1);
                }}
                className={INP}
              >
                <option value="">Select financial year…</option>
                {finYearOptions.map((fy) => <option key={fy.id} value={fy.year}>{fy.year}</option>)}
              </select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Field label="Document">
            <DocNumberPreview
              module="WD"
              finYear={form.finYear || undefined}
              selectedDocTypeId={form.docTypeId}
              preview={form.docNo}
              refreshTrigger={docRefreshTrigger}
              onSelect={(id, preview) => {
                setField("docTypeId", id);
                setField("docNo", preview);
              }}
            />
          </Field>
          <Field label="Date" required error={errors.docDate}>
            <DateInput value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={`${INP} ${errors.docDate ? "border-destructive" : ""}`} />
          </Field>
          <Field label="Supplier">
            {loadingDropdowns ? skel : (
              <select value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} className={INP}>
                <option value="">Select supplier…</option>
                {suppliers.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Remarks">
          <textarea value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} placeholder="Optional remarks…" rows={2} className={TEXTAREA} />
        </Field>
      </Block>

      <Block title="Work order" note="Only approved work orders can have work certified against them.">
        <Field label="Work order">
          {loadingDropdowns ? skel : (
            <select
              value={form.workOrderId}
              onChange={(e) => {
                setField("workOrderId", e.target.value);
                void loadWorkOrder(e.target.value, true);
              }}
              className={INP}
            >
              <option value="">{pickable.length ? "Select work order…" : "No approved work orders for this company / project"}</option>
              {pickable.map((wo) => <option key={wo.id} value={String(wo.id)}>{wo.name}</option>)}
            </select>
          )}
        </Field>

        {woLoading && <p className="text-xs text-muted-foreground animate-pulse">Loading the work order…</p>}

        {woSummary && !woLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4" style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
            {[
              { label: "Contract value", value: woSummary.ContractValue },
              { label: "Certified so far", value: woSummary.totalCertified, note: "approved entries" },
              { label: "Booked", value: woSummary.totalBooked },
              { label: "Left to certify", value: leftToCertify ?? 0, red: (leftToCertify ?? 0) <= 0 },
            ].map((x, i) => (
              <div key={x.label} className="px-3 py-2.5" style={i ? { borderLeft: "1px solid hsl(var(--foreground) / 0.15)" } : undefined}>
                <p className={LBL} title={x.note}>{x.label}</p>
                <p className={`font-heading text-sm font-bold tabular-nums mt-0.5 ${x.red ? "text-destructive" : "text-foreground"}`}>{fmt(x.value)}</p>
              </div>
            ))}
          </div>
        )}

        {!woLoading && woActivities.length > 0 && (
          <div className="overflow-x-auto" style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.25)" }}>
                  {["Group", "Activity", "UOM", "Area", "Rate", "Labour", "Material", "Total"].map((h, i) => (
                    <th key={h} className={`${LBL} px-3 py-2 ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {woActivities.map((a) => (
                  <tr key={a.Id} className="border-b border-foreground/10">
                    <td className="px-3 py-2 text-muted-foreground">{a.ActivityGroupName || "—"}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{a.ActivityName || "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{a.UOMName || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.Area ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.Rate != null ? fmt(a.Rate) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.LabourAmount != null ? fmt(a.LabourAmount) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.MaterialAmount != null ? fmt(a.MaterialAmount) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{a.GrandTotal != null ? fmt(a.GrandTotal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid hsl(var(--foreground) / 0.4)" }}>
                  <td colSpan={5} className={`${LBL} px-3 py-2.5`}>Totals</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmt(sum("LabourAmount"))}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmt(sum("MaterialAmount"))}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums text-foreground">{fmt(sum("GrandTotal"))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!woLoading && form.workOrderId && !woActivities.length && <p className="text-sm text-muted-foreground">This work order has no activities.</p>}
      </Block>

      <Block title="Work done">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Period from">
            <DateInput value={form.PeriodFrom} onChange={(e) => setField("PeriodFrom", e.target.value)} className={INP} />
          </Field>
          <Field label="Period to">
            <DateInput value={form.PeriodTo} onChange={(e) => setField("PeriodTo", e.target.value)} className={INP} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <Field label="Quantity done" required error={errors.amount}>
            <input type="number" min="0" step="any" value={form.QuantityDone} onChange={(e) => setField("QuantityDone", e.target.value)} placeholder="0" className={`${INP} text-right tabular-nums ${errors.amount ? "border-destructive" : ""}`} />
          </Field>
          <Field label="Unit">
            <input type="text" value={form.Unit} onChange={(e) => setField("Unit", e.target.value)} placeholder="Sqft, Rmt, LS…" className={INP} />
          </Field>
          <Field label="Rate per unit (₹)" required error={errors.amount}>
            <input type="number" min="0" step="any" value={form.RatePerUnit} onChange={(e) => setField("RatePerUnit", e.target.value)} placeholder="0.00" className={`${INP} text-right tabular-nums ${errors.amount ? "border-destructive" : ""}`} />
          </Field>
          <Field label="Deductions (₹)">
            <input type="number" min="0" step="any" value={form.Deductions} onChange={(e) => setField("Deductions", e.target.value)} placeholder="0.00" className={`${INP} text-right tabular-nums`} />
          </Field>
        </div>

        <div className="grid grid-cols-3" style={{ border: RULE }}>
          {[
            { label: "Gross", value: fmt(gross), note: "quantity × rate" },
            { label: "Deductions", value: deductions ? `− ${fmt(deductions)}` : fmt(0) },
            { label: "Certified", value: fmt(certified), red: leftToCertify != null && certified > leftToCertify + 0.5 },
          ].map((x, i) => (
            <div key={x.label} className="px-4 py-3" style={i ? { borderLeft: "1px solid hsl(var(--foreground) / 0.2)" } : undefined}>
              <p className={LBL}>{x.label}</p>
              <p className={`font-heading text-lg font-bold tabular-nums mt-0.5 ${x.red ? "text-destructive" : "text-foreground"}`}>{x.value}</p>
              {x.red ? <p className="text-[0.6875rem] text-destructive">More than is left to certify on the work order</p> : x.note ? <p className="text-[0.6875rem] text-muted-foreground">{x.note}</p> : null}
            </div>
          ))}
        </div>

        <Field label="Description of work" required error={errors.DescriptionOfWork}>
          <textarea
            value={form.DescriptionOfWork}
            onChange={(e) => setField("DescriptionOfWork", e.target.value)}
            placeholder="Describe the work completed…"
            rows={3}
            className={`${TEXTAREA} ${errors.DescriptionOfWork ? "border-destructive" : ""}`}
          />
        </Field>
      </Block>

      <div className="flex items-center justify-end gap-2 pb-6">
        <button onClick={handleReset} disabled={saveMutation.isPending} className={`${KEY_LINE} h-9 px-4`}>
          <RotateCcw size={13} /> Reset
        </button>
        <button onClick={() => validate() && saveMutation.mutate()} disabled={saveMutation.isPending || loadingDropdowns} className={`${KEY_INK} h-9 px-4`}>
          <Save size={13} />
          {saveMutation.isPending ? "Saving…" : isEdit ? "Update work done" : "Save work done"}
        </button>
      </div>
    </div>
  );
}
