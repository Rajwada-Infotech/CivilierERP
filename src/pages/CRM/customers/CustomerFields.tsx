// Shared customer profile fields: identity & KYC, addresses (permanent + optional current), billing mode, and notes.
import React from "react";
import { FileText, MapPin, Receipt, UserCheck } from "lucide-react";
import { AutoInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import {
  CUST_INP, CUST_TEXTAREA, CustBlock, CustField, IDENTITY_FIELDS, type CustomerForm,
} from "./config";

type SetForm = (updater: (f: CustomerForm) => CustomerForm) => void;

export function CustomerFields({ form, setForm, readOnly = false, onIdentityBlur }: {
  form: CustomerForm; setForm: SetForm; readOnly?: boolean; onIdentityBlur?: (key: keyof CustomerForm) => void;
}) {
  const set = (k: keyof CustomerForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const addressSection = (prefix: "Permanent" | "Current") => (
    <div className="space-y-3">
      <CustField label={prefix === "Permanent" ? "Permanent address" : "Current address"}>
        <textarea
          value={form[`${prefix}Address`] as string}
          readOnly={readOnly}
          rows={2}
          placeholder={prefix === "Permanent" ? "House/flat, street, locality…" : "Correspondence address…"}
          onChange={(e) => set(`${prefix}Address`, e.target.value)}
          className={CUST_TEXTAREA}
        />
      </CustField>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["City", "State", "Pincode"] as const).map((part) => (
          <CustField key={part} label={part}>
            <input
              type="text"
              value={form[`${prefix}${part}`] as string}
              readOnly={readOnly}
              onChange={(e) => set(`${prefix}${part}`, e.target.value)}
              className={CUST_INP}
            />
          </CustField>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <CustBlock title="Identity & KYC" icon={<UserCheck size={14} className="text-primary" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {IDENTITY_FIELDS.map(({ key, label, type, required }) => (
            <CustField key={key} label={label} required={required} className={key === "CustomerName" ? "sm:col-span-2" : undefined}>
              <AutoInput
                type={type}
                value={form[key] as string}
                readOnly={readOnly}
                onChange={(e) => set(key, e.target.value)}
                onBlur={() => onIdentityBlur?.(key)}
                className={CUST_INP}
              />
            </CustField>
          ))}
        </div>
      </CustBlock>

      <div className="space-y-4">
        <CustBlock title="Addresses" icon={<MapPin size={14} className="text-primary" />}>
          {addressSection("Permanent")}
          <label className={cn(
            "inline-flex items-center gap-2 text-xs text-foreground pt-1 select-none",
            readOnly ? "opacity-75" : "cursor-pointer",
          )}>
            <input
              type="checkbox"
              checked={form.IsCurrentSameAsPermanent}
              disabled={readOnly}
              onChange={(e) => set("IsCurrentSameAsPermanent", e.target.checked)}
              className="w-4 h-4 rounded accent-primary disabled:opacity-50"
            />
            Current correspondence address is the same
          </label>
          {!form.IsCurrentSameAsPermanent && (
            <div className="pt-2 border-t border-border">
              {addressSection("Current")}
            </div>
          )}
        </CustBlock>

        <CustBlock
          title="Billing mode"
          icon={<Receipt size={14} className="text-primary" />}
          note="Non-invoice profiles never receive a GST Sale Invoice"
        >
          <div className="grid grid-cols-2 gap-2.5">
            {(["NonInvoice", "Invoice"] as const).map((mode) => {
              const selected = form.InvoiceMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={readOnly}
                  onClick={() => !readOnly && set("InvoiceMode", mode)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-xs transition-colors flex items-center gap-2",
                    selected
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border bg-card text-foreground hover:bg-muted/40",
                    readOnly && "cursor-default",
                  )}
                >
                  <span className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center",
                    selected ? "border-primary" : "border-muted-foreground/40",
                  )}>
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-primary block" />}
                  </span>
                  {mode === "NonInvoice" ? "Non-invoice" : "Invoice (GST)"}
                </button>
              );
            })}
          </div>
        </CustBlock>

        <CustBlock title="Notes" icon={<FileText size={14} className="text-primary" />}>
          <textarea
            value={form.Notes}
            readOnly={readOnly}
            rows={2}
            placeholder="Internal profile remarks…"
            onChange={(e) => set("Notes", e.target.value)}
            className={CUST_TEXTAREA}
          />
        </CustBlock>
      </div>
    </div>
  );
}
