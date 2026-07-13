import React, { useState } from "react";
import { toast } from "sonner";
import { Phone, MessageSquare, MessageCircle, Mail, PhoneCall, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Shared across every CRM page that needs a direct-contact affordance
// (Communication Log, Welcome Call, ...) — one implementation instead of
// each page re-inventing tel:/sms:/wa.me/mailto: links.

// Indian mobile numbers stored as plain 10-digit strings (occasionally with a
// leading 0 or +91) — wa.me needs the bare country-code-prefixed digits.
export function toWhatsAppNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").replace(/^0+/, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

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
      <DialogContent className="max-w-xs text-center">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center justify-center gap-1.5"><PhoneCall size={16} className="text-primary" /> Call {applicantName}</DialogTitle>
        </DialogHeader>
        <div className="py-3">
          <div className="text-2xl font-bold tracking-wide text-foreground">{mobile}</div>
          <p className="text-xs text-muted-foreground mt-1">On mobile, "Call Now" opens your dialer. On desktop, copy the number to dial manually.</p>
        </div>
        <div className="flex flex-col gap-2">
          <a href={`tel:${mobile}`}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center justify-center gap-1.5">
            <PhoneCall size={14} /> Call Now
          </a>
          <button onClick={handleCopy}
            className="px-4 py-2 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center justify-center gap-1.5">
            <Copy size={14} /> Copy Number
          </button>
          <a href={`sms:${mobile}`}
            className="px-4 py-2 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center justify-center gap-1.5">
            <MessageSquare size={14} /> Send SMS Instead
          </a>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground pt-1">Close</button>
      </DialogContent>
    </Dialog>
  );
}

// Direct-contact buttons: Call / SMS / WhatsApp / Email, straight to the
// customer's real number/address — no separate lookup, no leaving the page.
// Optionally reports which channel was used back to the caller so a log
// form can reflect it automatically.
export function ContactActionBar({
  applicantName, mobile, email, onUsed, compact,
}: { applicantName: string; mobile: string | null; email: string | null; onUsed?: (channel: string) => void; compact?: boolean }) {
  const [calling, setCalling] = useState(false);
  if (!mobile && !email) return null;
  const btnCls = compact
    ? "flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border font-medium"
    : "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium";

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {mobile && (
          <button onClick={() => { setCalling(true); onUsed?.("Call"); }}
            className={`${btnCls} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
            <Phone size={compact ? 11 : 13} /> Call
          </button>
        )}
        {mobile && (
          <a href={`sms:${mobile}`} onClick={() => onUsed?.("SMS")}
            className={`${btnCls} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}>
            <MessageSquare size={compact ? 11 : 13} /> SMS
          </a>
        )}
        {mobile && (
          <a href={`https://wa.me/${toWhatsAppNumber(mobile)}`} target="_blank" rel="noreferrer" onClick={() => onUsed?.("WhatsApp")}
            className={`${btnCls} border-green-200 bg-green-50 text-green-700 hover:bg-green-100`}>
            <MessageCircle size={compact ? 11 : 13} /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} onClick={() => onUsed?.("Email")}
            className={`${btnCls} border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100`}>
            <Mail size={compact ? 11 : 13} /> Email
          </a>
        )}
      </div>
      {calling && mobile && <CallDialog applicantName={applicantName} mobile={mobile} onClose={() => setCalling(false)} />}
    </>
  );
}
