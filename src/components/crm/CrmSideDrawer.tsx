import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Right-hand detail/edit panel so list rows stay one line tall. Esc or backdrop click closes; Radix traps focus
 *  and locks the page's scroll while it's open. */
export function CrmSideDrawer({ open, onClose, title, subtitle, badge, children, footer }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        {/* Above the top bar (z-50), at the dialogs' level: at z-40 the bar covered the panel's header. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/30 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-[60] h-full w-full sm:w-[440px] bg-card flex flex-col outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          style={{ borderLeft: "1px solid hsl(var(--foreground))" }}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogPrimitive.Title className="font-heading text-lg font-bold truncate">{title}</DialogPrimitive.Title>
                {badge}
              </div>
              <DialogPrimitive.Description className={subtitle ? "text-xs text-muted-foreground mt-0.5 tabular-nums" : "sr-only"}>
                {subtitle || "CRM detail panel"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close"
              className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-foreground shrink-0">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="px-5 py-3" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
