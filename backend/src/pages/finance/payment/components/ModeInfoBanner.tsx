import React from "react";
import { Banknote, BookOpen, CalendarClock, Hash, Smartphone, CreditCard } from "lucide-react";

export function ModeInfoBanner({ mode }: { mode: string }) {
  const colorClasses: Record<string, { container: string; icon: string }> = {
    emerald: {
      container: "bg-emerald-500/5 border border-emerald-500/20",
      icon: "text-emerald-500",
    },
    blue: {
      container: "bg-blue-500/5 border border-blue-500/20",
      icon: "text-blue-500",
    },
    indigo: {
      container: "bg-indigo-500/5 border border-indigo-500/20",
      icon: "text-indigo-500",
    },
    cyan: {
      container: "bg-cyan-500/5 border border-cyan-500/20",
      icon: "text-cyan-500",
    },
    violet: {
      container: "bg-violet-500/5 border border-violet-500/20",
      icon: "text-violet-500",
    },
    orange: {
      container: "bg-orange-500/5 border border-orange-500/20",
      icon: "text-orange-500",
    },
    pink: {
      container: "bg-pink-500/5 border border-pink-500/20",
      icon: "text-pink-500",
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
