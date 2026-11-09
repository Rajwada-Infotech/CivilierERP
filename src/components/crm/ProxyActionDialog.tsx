import React, { useState } from "react";
import { UserCircle2 } from "lucide-react";
import { GridDialog, GridFormField, GridSegment, GRID_BTN, GRID_BTN_BRAND, GRID_INPUT } from "@/components/crm/CrmDataTable";

export const PROXY_METHODS = ["Phone", "InPerson", "Email", "WhatsApp", "Other"] as const;
export type ProxyMethod = typeof PROXY_METHODS[number];
export const PROXY_METHOD_LABELS: Record<ProxyMethod, string> = {
  Phone:    "Phone call",
  InPerson: "In-person visit",
  Email:    "Email / document",
  WhatsApp: "WhatsApp / SMS",
  Other:    "Other",
};
const PROXY_PLACEHOLDER: Record<ProxyMethod, string> = {
  Phone:    "e.g. Customer called on 28 Aug, confirmed verbally",
  InPerson: "e.g. Customer visited office, signed physical copy",
  Email:    "e.g. Email received from customer at 10:30 AM",
  WhatsApp: "e.g. WhatsApp message confirming, screenshot saved",
  Other:    "e.g. Describe how the customer confirmed",
};

export function ProxyActionDialog({
  title, description, confirmLabel, onConfirm, onClose, saving,
}: {
  title: string; description: string; confirmLabel: string;
  onConfirm: (method: ProxyMethod, remarks: string) => void;
  onClose: () => void; saving: boolean;
}) {
  const [method, setMethod] = useState<ProxyMethod>("Phone");
  const [remarks, setRemarks] = useState("");
  return (
    <GridDialog onClose={onClose} icon={UserCircle2} width="max-w-2xl" title={title} description={`${description} Recorded permanently as a staff entry in the audit trail.`}
      footer={<>
        <button onClick={onClose} className={GRID_BTN}>Cancel</button>
        <button onClick={() => remarks.trim() && onConfirm(method, remarks.trim())} disabled={saving || !remarks.trim()} className={GRID_BTN_BRAND}>{saving ? "Saving…" : confirmLabel}</button>
      </>}>
      <GridFormField label="How did the customer communicate?" required>
        <span className="block overflow-x-auto">
          <GridSegment<ProxyMethod> label="How did the customer communicate?" value={method} onChange={setMethod} options={PROXY_METHODS.map((m) => ({ key: m, label: PROXY_METHOD_LABELS[m] }))} />
        </span>
      </GridFormField>
      <GridFormField label="Notes for the record" required hint="The customer's portal access remains active.">
        <textarea value={remarks} rows={3} placeholder={PROXY_PLACEHOLDER[method]} onChange={(e) => setRemarks(e.target.value)} className={`${GRID_INPUT} h-auto py-2 resize-none`} />
      </GridFormField>
    </GridDialog>
  );
}
