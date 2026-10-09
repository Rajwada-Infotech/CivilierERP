import { useQuery } from "@tanstack/react-query";
import { Home, Landmark } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const fmt = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

interface PropertyMilestone {
  Id: number; BookingId: number; BookingNo: string; Part: "Land" | "Villa";
  Label: string; AmountDue: number; AmountPaid: number; DueDate: string | null; Status: string;
}
interface Property {
  combined: boolean;
  bookings: { Id: number; BookingNo: string; UnitNo: string | null; TotalValue: number; IsLand: number }[];
  schedule: PropertyMilestone[];
  totals: { price: number; paid: number; due: number };
}

/**
 * A plot and the villa built on it, held by the same buyer, are one property:
 * one schedule (the plot's balance first) and one price / paid / due. Shown
 * only when the booking has such a partner; otherwise renders nothing.
 */
export function PropertyCard({ bookingId }: { bookingId: number }) {
  const { data } = useQuery<Property>({
    queryKey: ["crm-booking-property", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/crm/bookings/${bookingId}/property`);
      if (!r.ok) throw new Error("Could not load the property");
      return r.json();
    },
    enabled: Number.isInteger(bookingId) && bookingId > 0,
  });
  if (!data?.combined) return null;
  return (
    <section className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2.5" aria-label="Property: plot and villa">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Home size={11} /> One property · plot + villa
        </span>
        <span className="text-[0.6875rem] text-muted-foreground">{data.bookings.map((b) => `${b.UnitNo || b.BookingNo} (${b.BookingNo})`).join(" + ")}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {([["Price", data.totals.price], ["Paid", data.totals.paid], ["Due", data.totals.due]] as const).map(([k, v]) => (
          <div key={k} className="rounded-md bg-muted/30 py-1.5">
            <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{fmt(v)}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Milestone</th>
              <th className="py-1 pr-2 font-medium text-right">Due</th>
              <th className="py-1 pr-2 font-medium text-right">Paid</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.schedule.map((m) => (
              <tr key={m.Id} className="border-t border-border/60">
                <td className="py-1 pr-2">
                  <span className="inline-flex items-center gap-1">
                    {m.Part === "Land" ? <Landmark size={11} className="text-amber-600" /> : <Home size={11} className="text-primary" />}
                    {m.Label}
                  </span>
                </td>
                <td className="py-1 pr-2 text-right">{fmt(m.AmountDue)}</td>
                <td className="py-1 pr-2 text-right">{fmt(m.AmountPaid)}</td>
                <td className="py-1">{m.Status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">The plot's balance is settled first; payments against it are land (no GST), the rest is the villa.</p>
    </section>
  );
}
