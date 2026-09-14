import { Receipt, CheckCircle2, Clock, CreditCard } from "lucide-react";
import { StatCard } from "./PickerPrimitives";
import { fmt } from "./helpers";

interface ExpenseBookingStatCardsProps {
  totalNet: number;
  approvedCount: number;
  pendingCount: number;
  emiCount: number;
}

export function ExpenseBookingStatCards({
  totalNet,
  approvedCount,
  pendingCount,
  emiCount,
}: ExpenseBookingStatCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="Total Booked"
        value={`₹${fmt(totalNet)}`}
        icon={Receipt}
        color="text-indigo-500 bg-indigo-500/10"
        accentColor="border-l-indigo-500"
      />
      <StatCard
        label="Approved"
        value={approvedCount}
        icon={CheckCircle2}
        color="text-indigo-500 bg-indigo-500/10"
        accentColor="border-l-indigo-500"
      />
      <StatCard
        label="Pending"
        value={pendingCount}
        icon={Clock}
        color="text-amber-500 bg-amber-500/10"
        accentColor="border-l-amber-500"
      />
      <StatCard
        label="EMI Active"
        value={emiCount}
        icon={CreditCard}
        color="text-violet-500 bg-violet-500/10"
        accentColor="border-l-violet-500"
      />
    </div>
  );
}
