// The parts of a customer both forms show: identity and money, the address (permanent always, current only when it
// differs), billing mode and notes. Used by New customer and the open customer alike, so the two never drift.
import React from "react";
import { AutoInput } from "@/components/ui/date-input";
import { Block, Field, IDENTITY_FIELDS, INP, TEXTAREA, type CustomerForm } from "./config";

type SetForm = (updater: (f: CustomerForm) => CustomerForm) => void;

export function CustomerFields({ form, setForm, readOnly = false, onIdentityBlur }: {
  form: CustomerForm; setForm: SetForm; readOnly?: boolean; onIdentityBlur?: (key: keyof CustomerForm) => void;
}) {
  const set = (k: keyof CustomerForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const address = (prefix: "Permanent" | "Current") => (
    <>
      <Field label={prefix === "Permanent" ? "Permanent address" : "Current address"}>
        <textarea value={form[`${prefix}Address`] as string} readOnly={readOnly} rows={2} onChange={(e) => set(`${prefix}Address`, e.target.value)} className={TEXTAREA} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["City", "State", "Pincode"] as const).map((part) => (
          <Field key={part} label={part}>
            <input type="text" value={form[`${prefix}${part}`] as string} readOnly={readOnly} onChange={(e) => set(`${prefix}${part}`, e.target.value)} className={INP} />
          </Field>
        ))}
      </div>
    </>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Block title="Person">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {IDENTITY_FIELDS.map(({ key, label, type, required }) => (
            <Field key={key} label={label} required={required} className={key === "CustomerName" ? "sm:col-span-2" : undefined}>
              <AutoInput type={type} value={form[key] as string} readOnly={readOnly}
                onChange={(e) => set(key, e.target.value)}
                onBlur={() => onIdentityBlur?.(key)}
                className={INP} />
            </Field>
          ))}
        </div>
      </Block>

      <div className="space-y-4">
        <Block title="Address">
          {address("Permanent")}
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={form.IsCurrentSameAsPermanent} disabled={readOnly} onChange={(e) => set("IsCurrentSameAsPermanent", e.target.checked)} className="accent-foreground" />
            Current address is the same
          </label>
          {!form.IsCurrentSameAsPermanent && address("Current")}
        </Block>

        <Block title="Billing" note="Non-invoice customers never get an invoice, here or in Accounts' Sale Invoice">
          <div className="flex items-center gap-5">
            {(["NonInvoice", "Invoice"] as const).map((mode) => (
              <label key={mode} className={`flex items-center gap-2 text-sm ${readOnly ? "opacity-70" : "cursor-pointer"}`}>
                <input type="radio" disabled={readOnly} checked={form.InvoiceMode === mode} onChange={() => set("InvoiceMode", mode)} className="accent-foreground" />
                {mode === "NonInvoice" ? "Non-invoice" : "Invoice"}
              </label>
            ))}
          </div>
        </Block>

        <Block title="Notes">
          <textarea value={form.Notes} readOnly={readOnly} rows={2} onChange={(e) => set("Notes", e.target.value)} className={TEXTAREA} />
        </Block>
      </div>
    </div>
  );
}
