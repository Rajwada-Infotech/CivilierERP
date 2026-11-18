import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Home, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
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
  const navigate = useNavigate();
  // A resale / buy-back case is opened under Resale Cases' create right (the server checks the same).
  const canStartCase = useAuth().canDoAction("crm-resales", "create");
  const { data = [], isLoading, isError } = useQuery<VillaOffer[]>({
    queryKey: ["crm-villa-offers"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/bookings/villa-offers");
      if (!r.ok) throw new Error("Failed to load villa offers");
      return r.json();
    },
  });
  // Hide while loading (no layout jump) and on error (silent — this is a
  // notification panel, not a primary view; a failed fetch just means it
  // doesn't appear, which is better than showing a broken state).
  if (isLoading || isError || !data.length) return null;
  // Villas built on plots of the same plot booking sit together: that booking's owner, balance and number are one
  // fact for all of them, shown once across their rows (a balance on every row read as owed per villa).
  const order = new Map<number, number>();
  data.forEach((o, i) => { if (!order.has(o.LandBookingId)) order.set(o.LandBookingId, i); });
  const rows = [...data].sort((a, b) => order.get(a.LandBookingId)! - order.get(b.LandBookingId)!);
  // How many rows each booking's cells cover: its first row the count, the rows after it 0.
  const spans = rows.map((o, i) => {
    if (i > 0 && rows[i - 1].LandBookingId === o.LandBookingId) return 0;
    let k = i;
    while (k < rows.length && rows[k].LandBookingId === o.LandBookingId) k++;
    return k - i;
  });
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
      <div className="overflow-x-auto max-h-52 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 z-10">
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
            {rows.map((o, i) => {
              const n = spans[i];
              return (
              <tr key={`${o.UnitId}-${o.LandBookingId}`} className="hover:bg-muted/50">
                <td className={GRID_TD}>
                  <span className="font-medium">{o.UnitName}</span><span className="text-muted-foreground"> · {o.ProjectName}</span>
                  {o.PlotName ? <span className="block text-muted-foreground">{o.PlotName.includes(",") ? "Plots" : "Plot"}: {o.PlotName}</span> : null}
                </td>
                <td className={GRID_TD}>{o.VillaTypeCode ? `${o.VillaTypeCode} · ${o.VillaTypeName}` : "—"}</td>
                {n > 0 && <>
                  <td rowSpan={n} className={cn(GRID_TD, "align-middle", n > 1 && "border-l border-border/70")}>{o.CustomerName || "—"}{o.Mobile ? <span className="text-muted-foreground"> · {o.Mobile}</span> : null}</td>
                  <td rowSpan={n} className={cn(GRID_TD, "align-middle text-right font-semibold")}>{o.LandDue > 0 ? fmt(o.LandDue) : "Paid"}</td>
                  <td rowSpan={n} className={cn(GRID_TD, "align-middle", n > 1 && "border-r border-border/70")}>
                    <span className="inline-flex items-center gap-1.5">
                      <Link to={`/crm/bookings?view=${o.LandBookingId}`} className="text-primary underline-offset-2 hover:underline">{o.LandBookingNo}</Link>
                      {/* A case starts from the plot booking: a buy-back takes the whole booking; a resale form lets
                          staff tick which of its plots are sold (each at its own price). */}
                      {canStartCase && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                              title="More actions" aria-label={`More actions for ${o.LandBookingNo}`}><MoreHorizontal size={14} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuItem onClick={() => navigate(`/crm/resales?newCase=Resale&fromBooking=${o.LandBookingId}`)}>Resale — to another buyer</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/crm/resales?newCase=BuyBack&fromBooking=${o.LandBookingId}`)}>Buy-back — bought back by us</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </span>
                  </td>
                </>}
                <td className={cn(GRID_TD, "text-right whitespace-nowrap")}>
                  <Link
                    to={`/crm/applications?newVilla=${o.UnitId}&customer=${o.CustomerId}&project=${o.ProjectId}&company=${o.CompanyId ?? ""}&block=${o.BlockId ?? ""}`}
                    className={cn(GRID_KEY, "h-7 px-2.5")}>
                    Start villa application
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
