import { Card } from "@/components/ui/card";
import { FileText, ChevronDown, CalendarDays } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { inputCls, selectCls, FieldLabel } from "./config";
import type { POState } from "./usePurchaseOrder";

// Header details: supplier, company, project, dates, delivery and payment terms.
export function POHeaderDetails({ m }: { m: POState }) {
  const { viewMode, poDocTypeId, form, errors, paymentTerms, suppliers, companies, allProjects, filteredFormProjects, items, maxDaysOfSupply, minExpectedDate, setField, isReadOnly, supplierDeviations, supplierChangeReason, setSupplierChangeReason } = m;
  return (
    <>
      {/* ── Header Details Card ───────────────────────────────────────────── */}
      <div className="border border-foreground bg-card p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] flex items-center gap-1.5 mb-4">
          <FileText
            size={11}
            className="text-foreground"
          />
          Order Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Company */}
          <div>
            <FieldLabel>Company Name</FieldLabel>
            {isReadOnly ? (
              <div className={`${inputCls} bg-card`}>
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
                  className={`appearance-none ${selectCls} ${errors.companyId ? "border-destructive" : ""}`}
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
              <div className={`${inputCls} bg-card`}>
                {allProjects.find((p) => p.id === form.projectId)?.name ||
                  "—"}
              </div>
            ) : (
              <div className="relative">
                <select
                  value={form.projectId}
                  onChange={(e) => setField("projectId", e.target.value)}
                  className={`appearance-none ${selectCls} ${errors.projectId ? "border-destructive" : ""}`}
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
              <div className={`${inputCls} bg-card`}>
                {suppliers.find((s) => s.id === form.supplierId)?.name ||
                  "—"}
              </div>
            ) : (
              <div className="relative">
                <SearchableNativeSelect
                  value={form.supplierId}
                  onChange={(e) => setField("supplierId", e.target.value)}
                  className={`${selectCls} ${errors.supplierId ? "border-destructive" : ""}`}
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

          {/* Not the quotation's L1 supplier: why (required; the directors are told). Read-only: the saved reason. */}
          {(isReadOnly ? !!supplierChangeReason : supplierDeviations.length > 0) && (
            <div className="sm:col-span-2 lg:col-span-3 border border-destructive/60 bg-destructive/5 p-3">
              {!isReadOnly && (
                <p className="text-xs text-foreground mb-2 leading-relaxed">
                  {supplierDeviations.map((d) => (
                    <span key={d.quotationId} className="block">
                      <b>{d.l1SupplierName || "Another supplier"}</b> is the lowest (L1) on {d.quotationDocNo}
                      {d.mrDocNo ? ` for ${d.mrDocNo}` : ""} at ₹{d.l1Total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {d.chosenQuoteTotal != null
                        ? `; this supplier quoted ₹${d.chosenQuoteTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : "; this supplier didn't quote on it"}
                      .
                    </span>
                  ))}
                  The directors will be notified of this PO.
                </p>
              )}
              <FieldLabel required={!isReadOnly}>Reason for choosing a different supplier</FieldLabel>
              {isReadOnly ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{supplierChangeReason}</p>
              ) : (
                <textarea
                  value={supplierChangeReason}
                  onChange={(e) => setSupplierChangeReason(e.target.value.slice(0, 1000))}
                  rows={2}
                  placeholder="e.g. L1 can't deliver before the slab casting date"
                  className={`${inputCls} h-auto py-2 ${errors.supplierChangeReason ? "border-destructive" : ""}`}
                />
              )}
            </div>
          )}

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
              className={`${inputCls} font-heading ${errors.poNumber ? "border-destructive" : ""} ${
                isReadOnly ||
                (viewMode === "create" && !!(form.docTypeId ?? poDocTypeId))
                  ? "bg-card cursor-not-allowed"
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
                className={`${inputCls} pl-8 ${errors.poDate ? "border-destructive" : ""} ${isReadOnly ? "bg-card cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
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
                className={`${inputCls} pl-8 ${isReadOnly ? "bg-card cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
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
              className={`${inputCls} ${isReadOnly ? "bg-card cursor-not-allowed" : ""}`}
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
