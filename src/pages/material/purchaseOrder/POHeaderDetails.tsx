import { Card } from "@/components/ui/card";
import { FileText, ChevronDown, CalendarDays } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { inputCls, selectCls, FieldLabel } from "./config";
import type { POState } from "./usePurchaseOrder";

// Header details: supplier, company, project, dates, delivery and payment terms.
export function POHeaderDetails({ m }: { m: POState }) {
  const { viewMode, poDocTypeId, form, errors, paymentTerms, suppliers, companies, allProjects, filteredFormProjects, items, maxDaysOfSupply, minExpectedDate, setField, isReadOnly } = m;
  return (
    <>
      {/* ── Header Details Card ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
          <FileText
            size={11}
            className="text-emerald-600 dark:text-emerald-400"
          />
          Order Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Company */}
          <div>
            <FieldLabel>Company Name</FieldLabel>
            {isReadOnly ? (
              <div className={`${inputCls} bg-muted/30`}>
                {companies.find((c) => c.id === form.companyId)?.name ||
                  "—"}
              </div>
            ) : (
              <div className="relative">
                <select
                  value={form.companyId}
                  onChange={(e) => {
                    setField("companyId", e.target.value);
                    setField("projectId", "");
                  }}
                  className={`appearance-none ${selectCls} ${errors.companyId ? "border-red-400" : ""}`}
                >
                  <option value="">— Select Company —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            )}
            {errors.companyId && (
              <p className="text-xs text-destructive mt-1">
                Company is required
              </p>
            )}
          </div>

          {/* Project */}
          <div>
            <FieldLabel required>Project / Site</FieldLabel>
            {isReadOnly ? (
              <div className={`${inputCls} bg-muted/30`}>
                {allProjects.find((p) => p.id === form.projectId)?.name ||
                  "—"}
              </div>
            ) : (
              <div className="relative">
                <select
                  value={form.projectId}
                  onChange={(e) => setField("projectId", e.target.value)}
                  className={`appearance-none ${selectCls} ${errors.projectId ? "border-red-400" : ""}`}
                >
                  <option value="">— Select Project —</option>
                  {filteredFormProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            )}
            {errors.projectId && (
              <p className="text-xs text-destructive mt-1">
                Project is required
              </p>
            )}
          </div>

          {/* Supplier */}
          <div>
            <FieldLabel required>Supplier</FieldLabel>
            {isReadOnly ? (
              <div className={`${inputCls} bg-muted/30`}>
                {suppliers.find((s) => s.id === form.supplierId)?.name ||
                  "—"}
              </div>
            ) : (
              <div className="relative">
                <SearchableNativeSelect
                  value={form.supplierId}
                  onChange={(e) => setField("supplierId", e.target.value)}
                  className={`${selectCls} ${errors.supplierId ? "border-red-400" : ""}`}
                >
                  <option value="">— Select Supplier —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SearchableNativeSelect>
              </div>
            )}
          </div>

          {/* PO Number */}
          <div>
            <FieldLabel required>PO Number</FieldLabel>
            <input
              value={form.poNumber}
              onChange={(e) =>
                setField("poNumber", e.target.value.toUpperCase())
              }
              readOnly={
                isReadOnly ||
                (viewMode === "create" && !!(form.docTypeId ?? poDocTypeId))
              }
              className={`${inputCls} font-mono ${errors.poNumber ? "border-red-400" : ""} ${
                isReadOnly ||
                (viewMode === "create" && !!(form.docTypeId ?? poDocTypeId))
                  ? "bg-muted/30 cursor-not-allowed"
                  : ""
              }`}
              placeholder="Auto-generated"
            />
          </div>

          {/* PO Date */}
          <div>
            <FieldLabel required>PO Date</FieldLabel>
            <div className="relative">
              <CalendarDays
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <DateInput
                value={form.poDate}
                onChange={(e) => setField("poDate", e.target.value)}
                readOnly={isReadOnly}
                className={`${inputCls} pl-8 ${errors.poDate ? "border-red-400" : ""} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
              />
            </div>
          </div>

          {/* Expected Delivery */}
          <div>
            <FieldLabel>Expected Delivery</FieldLabel>
            <div className="relative">
              <CalendarDays
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <DateInput
                value={form.expectedDate}
                min={minExpectedDate || undefined}
                onChange={(e) => setField("expectedDate", e.target.value)}
                readOnly={isReadOnly}
                className={`${inputCls} pl-8 ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
              />
            </div>
            {maxDaysOfSupply > 0 && (
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Earliest possible: {minExpectedDate} ({maxDaysOfSupply}-day supply lead time)
              </p>
            )}
          </div>

          {/* Payment Terms — Invoice computes its Due Date from Vendor
              Invoice Date + this term's Days once the PO/GRN is linked. */}
          <div>
            <FieldLabel>Payment Terms</FieldLabel>
            <select
              value={form.paymentTermId}
              onChange={(e) => setField("paymentTermId", e.target.value)}
              disabled={isReadOnly}
              className={`${inputCls} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
            >
              <option value="">— Select Payment Term —</option>
              {paymentTerms.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.label} ({pt.days} days)
                </option>
              ))}
            </select>
          </div>

        </div>
      </div>
    </>
  );
}
