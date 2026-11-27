import React, { useState } from "react";
import { toast } from "sonner";
import { Phone, MessageSquare, MessageCircle, Mail, PhoneCall, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GRID_KEY, GRID_KEY_BRAND } from "@/components/crm/CrmDataTable";
import { toWhatsAppNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";

// Shared across every CRM page that needs a direct-contact affordance
// (Communication Log, Welcome Call, ...) — one implementation instead of
// each page re-inventing tel:/sms:/wa.me/mailto: links.

// wa.me needs the bare country-code-prefixed digits — see src/lib/phone.ts.
export { toWhatsAppNumber };

// "Call" has no reliable direct-dial affordance on desktop, so instead of a
// bare tel: link that silently does nothing there, this pops up the number
// with a tel: link (works when there IS a dialer, e.g. mobile/Teams/Skype-
// enabled desktops) plus a copy-to-clipboard fallback for manual dialing.
export function CallDialog({ applicantName, mobile, onClose }: { applicantName: string; mobile: string; onClose: () => void }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(mobile);
    toast.success("Number copied");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs text-center rounded-xl p-5 gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-base font-semibold">
            <PhoneCall size={16} className="text-primary shrink-0" /> Call {applicantName}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div className="text-xl font-bold tracking-wide tabular-nums text-foreground">{mobile}</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            On mobile, Call Now opens your dialer. On desktop, copy the number to dial manually.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <a href={`tel:${mobile}`} className={cn(GRID_KEY_BRAND, "h-9 px-4")}>
            <PhoneCall size={14} /> Call Now
          </a>
          <button type="button" onClick={handleCopy} className={cn(GRID_KEY, "h-9 px-4 text-foreground")}>
            <Copy size={14} /> Copy Number
          </button>
          <a href={`sms:${mobile}`} className={cn(GRID_KEY, "h-9 px-4 text-foreground")}>
            <MessageSquare size={14} /> Send SMS Instead
          </a>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground pt-1">
          Close
        </button>
      </DialogContent>
    </Dialog>
  );
}

// Direct-contact buttons: Call / SMS / WhatsApp / Email, straight to the
// customer's real number/address — no separate lookup, no leaving the page.
// Optionally reports which channel was used back to the caller so a log
// form can reflect it automatically.
export function ContactActionBar({
  applicantName, mobile, email, onUsed, compact, onDark,
}: { applicantName: string; mobile: string | null; email: string | null; onUsed?: (channel: string) => void; compact?: boolean; onDark?: boolean }) {
  const [calling, setCalling] = useState(false);
  if (!mobile && !email) return null;
  const btnCls = onDark
    ? cn("inline-flex items-center justify-center gap-1.5 rounded-md border border-white/25 font-medium text-white hover:bg-white/10 transition-colors", compact ? "h-7 px-2.5 text-[0.6875rem]" : "h-8 px-3 text-xs")
    : cn(GRID_KEY, compact ? "h-7 px-2 text-[0.6875rem]" : "h-8 px-2.5");

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {mobile && (
          <button type="button" onClick={() => { setCalling(true); onUsed?.("Call"); }} className={btnCls}>
            <Phone size={compact ? 11 : 13} /> Call
          </button>
        )}
        {mobile && (
          <a href={`sms:${mobile}`} onClick={() => onUsed?.("SMS")} className={btnCls}>
            <MessageSquare size={compact ? 11 : 13} /> SMS
          </a>
        )}
        {mobile && (
          <a href={`https://wa.me/${toWhatsAppNumber(mobile)}`} target="_blank" rel="noreferrer" onClick={() => onUsed?.("WhatsApp")} className={btnCls}>
            <MessageCircle size={compact ? 11 : 13} /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} onClick={() => onUsed?.("Email")} className={btnCls}>
            <Mail size={compact ? 11 : 13} /> Email
          </a>
        )}
      </div>
      {calling && mobile && <CallDialog applicantName={applicantName} mobile={mobile} onClose={() => setCalling(false)} />}
    </>
  );
}
