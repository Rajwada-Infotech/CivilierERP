import React, { useState } from "react";
import { UserCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const PROXY_METHODS = ["Phone", "InPerson", "Email", "WhatsApp", "Other"] as const;
export type ProxyMethod = typeof PROXY_METHODS[number];
export const PROXY_METHOD_LABELS: Record<ProxyMethod, string> = {
  Phone:    "Phone call",
  InPerson: "In-person visit",
  Email:    "Email / document",
  WhatsApp: "WhatsApp / SMS",
  Other:    "Other",
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <UserCircle2 size={16} className="text-primary" /> {title}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <strong>Proxy action</strong> — {description} Permanently stamped as a staff-proxy record in the audit trail.
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">
              How did the customer communicate? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROXY_METHODS.map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                  className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors text-left ${
                    method === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                  }`}>
                  {PROXY_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              Notes for the record <span className="text-red-500">*</span>
            </label>
            <textarea
              value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3}
              placeholder={
                method === "Phone"    ? "e.g. Customer called on 28 Aug, confirmed verbally" :
                method === "InPerson" ? "e.g. Customer visited office, signed physical copy" :
                method === "Email"    ? "e.g. Email received from customer at 10:30 AM" :
                method === "WhatsApp" ? "e.g. WhatsApp message confirming, screenshot saved" :
                "e.g. Describe how the customer confirmed"
              }
              className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            The customer's portal access remains active. They can still log in and view the status.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button
            onClick={() => remarks.trim() && onConfirm(method, remarks.trim())}
            disabled={saving || !remarks.trim()}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Saving..." : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
