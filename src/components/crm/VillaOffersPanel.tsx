import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { GRID_CARD, GRID_KEY, GRID_TD, GRID_TH } from "@/components/crm/CrmDataTable";

interface VillaOffer {
  UnitId: number; UnitName: string; ProjectId: number; BlockId: number | null; CompanyId: number | null; CustomerId: number; ProjectName: string | null; VillaTypeCode: string | null; VillaTypeName: string | null;
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
    <section className={cn(GRID_CARD, "rounded-xl overflow-hidden")} aria-label="Villas ready to offer to plot owners">
      <div className="px-4 py-3 flex items-start gap-3 border-b border-border">
        <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 inline-flex items-center justify-center"><Home size={15} /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Villa ready — offer to plot owner <span className="ml-1 tabular-nums px-1.5 rounded-full bg-muted text-[0.6875rem] text-muted-foreground">{data.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The owner can buy the villa (new application for this customer, villa at its extended price — any plot balance is settled first), sell the plot back to us, or resell it.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left">
              <th className={GRID_TH}>Villa</th>
              <th className={GRID_TH}>Type</th>
              <th className={GRID_TH}>Plot owner</th>
              <th className={cn(GRID_TH, "text-right")}>Plot balance</th>
              <th className={GRID_TH}>Plot booking</th>
              <th className={GRID_TH}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={`${o.UnitId}-${o.LandBookingId}`} className="hover:bg-muted/50">
                <td className={GRID_TD}>
                  <span className="font-medium">{o.UnitName}</span><span className="text-muted-foreground"> · {o.ProjectName}</span>
                  {o.PlotName ? <span className="block text-muted-foreground">Plots: {o.PlotName}</span> : null}
                </td>
                <td className={GRID_TD}>{o.VillaTypeCode ? `${o.VillaTypeCode} · ${o.VillaTypeName}` : "—"}</td>
                <td className={GRID_TD}>{o.CustomerName || "—"}{o.Mobile ? <span className="text-muted-foreground"> · {o.Mobile}</span> : null}</td>
                <td className={cn(GRID_TD, "text-right font-semibold")}>{o.LandDue > 0 ? fmt(o.LandDue) : "Paid"}</td>
                <td className={GRID_TD}>
                  <Link to={`/crm/bookings?view=${o.LandBookingId}`} className="text-primary underline-offset-2 hover:underline">{o.LandBookingNo}</Link>
                </td>
                <td className={cn(GRID_TD, "text-right whitespace-nowrap")}>
                  <Link
                    to={`/crm/applications?newVilla=${o.UnitId}&customer=${o.CustomerId}&project=${o.ProjectId}&company=${o.CompanyId ?? ""}&block=${o.BlockId ?? ""}`}
                    className={cn(GRID_KEY, "h-7 px-2.5")}>
                    Start villa application
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
