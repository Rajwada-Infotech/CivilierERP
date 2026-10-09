import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface VillaOffer {
  UnitId: number; UnitName: string; ProjectName: string | null; VillaTypeCode: string | null; VillaTypeName: string | null;
  PlotName: string; LandBookingId: number; LandBookingNo: string; CustomerName: string | null; Mobile: string | null; LandDue: number;
}

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * "Villa ready — offer to plot owner": villas built on plots a buyer already
 * owns, where that owner has neither applied for nor booked the villa and no
 * resale is open. Hidden when there are none.
 */
export function VillaOffersPanel() {
  const { data = [] } = useQuery<VillaOffer[]>({
    queryKey: ["crm-villa-offers"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/bookings/villa-offers");
      if (!r.ok) return [];
      return r.json();
    },
  });
  if (!data.length) return null;
  return (
    <section className="rounded-lg border border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2.5 space-y-2" aria-label="Villas ready to offer to plot owners">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
        <Home size={11} /> Villa ready — offer to plot owner ({data.length})
      </p>
      <p className="text-[0.6875rem] text-muted-foreground">
        The owner can buy the villa (new application for this customer, villa at its extended price — any plot balance is settled first), sell the plot back to us, or resell it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Villa</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">Plot owner</th>
              <th className="py-1 pr-2 font-medium text-right">Plot balance</th>
              <th className="py-1 font-medium">Plot booking</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={`${o.UnitId}-${o.LandBookingId}`} className="border-t border-border/60">
                <td className="py-1 pr-2">{o.UnitName}<span className="text-muted-foreground"> · {o.ProjectName}</span></td>
                <td className="py-1 pr-2">{o.VillaTypeCode ? `${o.VillaTypeCode} · ${o.VillaTypeName}` : "—"}</td>
                <td className="py-1 pr-2">{o.CustomerName || "—"}{o.Mobile ? <span className="text-muted-foreground"> · {o.Mobile}</span> : null}</td>
                <td className="py-1 pr-2 text-right">{o.LandDue > 0 ? fmt(o.LandDue) : "Paid"}</td>
                <td className="py-1">
                  <Link to={`/crm/bookings?view=${o.LandBookingId}`} className="text-primary underline-offset-2 hover:underline">{o.LandBookingNo}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
