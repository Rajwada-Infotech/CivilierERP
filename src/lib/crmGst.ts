// Previews of an extra charge's GST before it is saved. The rate always comes
// from the server — for an application, its price quote (src/lib/crmPriceQuote.ts);
// for a booking, useExtraWorkRate below — which applies the GST rules master,
// plot sales and completed buildings. Nothing here decides a rate.
//
// This file used to carry its own copy of the Unit + Parking rule (the Rs 45
// lakh line and HSN codes written in), which the application form priced with;
// it disagreed with the booking whenever the rules master, a commercial unit,
// villa land or a completed building came into it. That is gone: the form
// shows the server's quote.
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/** The rate (%) an extra charge on this booking is taxed at. */
export function useExtraWorkRate(bookingId: number | null | undefined) {
  return useQuery({
    queryKey: ["crm-extra-work-rate", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/crm/extra-charges/${bookingId}/gst-rate`);
      if (!r.ok) throw new Error("Couldn't read the GST rate");
      return Number((await r.json()).rate) || 0;
    },
    enabled: bookingId != null,
    staleTime: 5 * 60_000,
  });
}

export type ExtraWorkGstResult = { rate: number; base: number; gstAmount: number; total: number };

/** An amount and its GST at a rate the server gave, to the paisa (as the server stores it). */
export function computeExtraWorkGst(amount: number, ratePercent: number): ExtraWorkGstResult {
  const base = Number(amount) || 0;
  const gstAmount = Math.round(base * ratePercent) / 100;
  return { rate: ratePercent, base, gstAmount, total: Math.round((base + gstAmount) * 100) / 100 };
}

export function fmtInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}
