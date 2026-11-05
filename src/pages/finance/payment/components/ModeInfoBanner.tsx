import React from "react";
import { Banknote, BookOpen, CalendarClock, Hash, Smartphone, CreditCard } from "lucide-react";

export function ModeInfoBanner({ mode }: { mode: string }) {
  const colorClasses: Record<string, { container: string; icon: string }> = {
    emerald: {
      container: "bg-primary/10 border border-foreground/40",
      icon: "text-foreground",
    },
    blue: {
      container: "bg-primary/10 border border-foreground/40",
      icon: "text-foreground",
    },
    indigo: {
      container: "bg-muted/60 border border-border",
      icon: "text-foreground",
    },
    cyan: {
      container: "bg-primary/10 border border-foreground/40",
      icon: "text-foreground",
    },
    violet: {
      container: "bg-muted/60 border border-border",
      icon: "text-foreground",
    },
    orange: {
      container: "bg-primary/10 border border-foreground/40",
      icon: "text-foreground",
    },
    pink: {
      container: "bg-primary/10 border border-foreground/40",
      icon: "text-foreground",
    },
    amber: {
      container: "bg-amber-500/5 border border-amber-500/20",
      icon: "text-amber-500",
    },
  };
  const msgs: Record<
    string,
    { icon: React.ElementType; color: string; text: string }
  > = {
    Cash: {
      icon: Banknote,
      color: "emerald",
      text: "Enter the raw cash amount to be paid.",
    },
    Cheque: {
      icon: BookOpen,
      color: "blue",
      text: "Select a bank and lot to auto-populate cheque details. One cheque will be deducted from the lot inventory.",
    },
    "Post-Dated Cheque": {
      icon: CalendarClock,
      color: "indigo",
      text: "Same as cheque — enter a future cheque date. The record is stored as a scheduled payment.",
    },
    NEFT: {
      icon: Hash,
      color: "cyan",
      text: "Post-transaction: enter the NEFT UTR number for reconciliation. Record will go for approval after save.",
    },
    UPI: {
      icon: Smartphone,
      color: "violet",
      text: "Post-transaction: enter the UPI Transaction ID. Record will go for approval after save.",
    },
    RTGS: {
      icon: Hash,
      color: "orange",
      text: "Post-transaction: enter the RTGS UTR reference. Record will go for approval after save.",
    },
    IMPS: {
      icon: Hash,
      color: "pink",
      text: "Post-transaction: enter the IMPS reference number. Record will go for approval after save.",
    },
    Card: {
      icon: CreditCard,
      color: "amber",
      text: "Post-transaction: enter the card transaction/approval ID for reconciliation. Record will go for approval after save.",
    },
  };
  const m = msgs[mode];
  if (!m) return null;
  const Icon = m.icon;
  const classes = colorClasses[m.color] ?? colorClasses.emerald;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg px-4 py-3 ${classes.container}`}
    >
      <Icon size={14} className={`${classes.icon} shrink-0 mt-0.5`} />
      <p className="text-xs text-muted-foreground">{m.text}</p>
    </div>
  );
}
