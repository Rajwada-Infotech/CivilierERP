// What is waiting on the customer. The rules live on the server (crmPortal.js needsYou), shared with the web portal's
// "Needs Your Action" — this file only fetches that list and says which screen takes each action.
import { useQuery } from "@tanstack/react-query";
import { portal, type NeedsYouItem } from "@/api/customerPortalApi";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";

export interface Todo extends NeedsYouItem { route: keyof CustomerStackParamList }

const ROUTE: Record<NeedsYouItem["target"], keyof CustomerStackParamList> = {
  documents: "CustomerDocuments",
  payments: "CustomerPayments",
  construction: "CustomerConstruction",
  transferDeed: "CustomerTransferDeed",
};

/** Across all the customer's homes (no id), or just one property's. */
export function useNeedsYou(appId?: number | null) {
  const all = appId === undefined;
  return useQuery({
    queryKey: ["portal-needs-you", all ? "all" : appId],
    queryFn: () => portal.needsYou(all ? undefined : (appId as number)),
    enabled: all || appId != null,
    select: (items): Todo[] => items.map((x) => ({ ...x, route: ROUTE[x.target] })),
  });
}
