import { fmt } from "./helpers";

interface ExpenseBookingStatCardsProps {
  totalNet: number;
  approvedCount: number;
  pendingCount: number;
  emiCount: number;
}

// Four figures on a ruled row (the sheet frame supplies .statrow, .label and .figure).
export function ExpenseBookingStatCards({ totalNet, approvedCount, pendingCount, emiCount }: ExpenseBookingStatCardsProps) {
  const items = [
    { label: "Total booked", value: `₹${fmt(totalNet)}`, note: "net, on this page of the list" },
    { label: "Approved", value: approvedCount.toLocaleString("en-IN"), note: "in all" },
    { label: "Pending", value: pendingCount.toLocaleString("en-IN"), note: "awaiting approval, in all" },
    { label: "On EMI", value: emiCount.toLocaleString("en-IN"), note: "on this page of the list" },
  ];
  return (
    <div className="statrow four">
      {items.map((x) => (
        <div key={x.label}>
          <p className="label">{x.label}</p>
          <p className="figure" style={{ fontSize: "clamp(20px, 2.2vw, 30px)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.value}</p>
          <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
        </div>
      ))}
    </div>
  );
}
