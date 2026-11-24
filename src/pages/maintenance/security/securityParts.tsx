// Shared pieces of the three Security Intercom admin pages (Maintenance → Security Gates / Security Guards / Residents).
import React from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HR_FIELD, HR_HEAD, HR_LBL } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";

export const fieldCls = HR_FIELD;
export const labelCls = `block mb-1.5 ${HR_LBL}`;

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A sheet dialog with a Cancel / confirm footer. */
export function SheetDialog({
  title,
  onClose,
  onSubmit,
  saving,
  submitLabel,
  icon,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  saving?: boolean;
  submitLabel?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`sheet-frame rounded-none ${wide ? "max-w-xl" : "max-w-md"}`} style={{ margin: 0 }}>
        <DialogHeader>
          <DialogTitle className={HR_HEAD}>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {children}
          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button type="button" onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>
              {onSubmit ? "Cancel" : "Close"}
            </button>
            {onSubmit && (
              <button type="button" onClick={onSubmit} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : icon} {submitLabel ?? "Save"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "No rows" / "loading" line inside a table body. */
export function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export const flatLabel = (block: string | null | undefined, flat: string) => (block ? `${block}-${flat}` : flat);
