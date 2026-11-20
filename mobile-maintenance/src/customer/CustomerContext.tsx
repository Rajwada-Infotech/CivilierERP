// The customer's properties and the one they are looking at. Every customer screen reads the chosen application from
// here, as the web portal's PortalLayout does with its picker.
//   homes — live bookings and applications still in progress (the switcher);
//   past  — cancelled / sold / moved / expired ones, kept reachable read-only (Profile → Past properties).
// The server decides which is which (crmPortal.js propertyState). The last property chosen is remembered.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { portal, type MoneyStatement, type PortalApplication, type PortalMe, type Timeline } from "@/api/customerPortalApi";

interface CustomerCtx {
  me: UseQueryResult<PortalMe>;
  apps: UseQueryResult<PortalApplication[]>;
  /** Live homes and applications in progress, homes first. */
  homes: PortalApplication[];
  /** Properties that ended — read-only history. */
  past: PortalApplication[];
  app: PortalApplication | null;
  appId: number | null;
  setAppId: (id: number) => void;
  timeline: UseQueryResult<Timeline>;
  /** The chosen property's money statement (GET /money) — the ONE source of every paid / total / balance figure in the
   *  app (Home, Payments, Profile), so no two screens can disagree. */
  money: UseQueryResult<MoneyStatement | null>;
  /** A co-applicant, or a past property: look, don't act (the server enforces the co-applicant rule). */
  readOnly: boolean;
}

const Ctx = createContext<CustomerCtx | undefined>(undefined);
const LAST_KEY = "civ_customer_last_property";

// A tapped notification names the property it is about: the provider switches to it (even when the tap started the
// app and the provider mounts afterwards).
let wanted: number | null = null;
const listeners = new Set<(id: number) => void>();
export function showApplication(applicationId: number) {
  wanted = applicationId;
  listeners.forEach((fn) => fn(applicationId));
}

export function CustomerProvider({ children }: PropsWithChildren) {
  const me = useQuery({ queryKey: ["portal-me"], queryFn: portal.me });
  const apps = useQuery({ queryKey: ["portal-applications"], queryFn: portal.applications });
  const [chosen, setChosen] = useState<number | null>(wanted);
  const [remembered, setRemembered] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(LAST_KEY).then((v) => setRemembered(v ? Number(v) : null)).catch(() => setRemembered(null));
    const fn = (id: number) => setChosen(id);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const setAppId = useCallback((id: number) => {
    setChosen(id);
    AsyncStorage.setItem(LAST_KEY, String(id)).catch(() => undefined);
  }, []);

  const list = useMemo(() => apps.data || [], [apps.data]);
  const homes = useMemo(() => list.filter((a) => a.Lifecycle !== "Past"), [list]);
  const past = useMemo(() => list.filter((a) => a.Lifecycle === "Past"), [list]);

  // Pick: the one already chosen (or named by a notification) → the one they last looked at, if it is still a home →
  // their first home (the server lists homes first) → their latest past booking (its payments and papers stay open)
  // → anything at all.
  useEffect(() => {
    if (!list.length || remembered === undefined) return;
    if (chosen && list.some((a) => a.ApplicationId === chosen)) return;
    const last = remembered != null ? homes.find((a) => a.ApplicationId === remembered) : undefined;
    setChosen((last || homes[0] || past.find((a) => a.BookingId) || list[0]).ApplicationId);
  }, [list, homes, past, chosen, remembered]);

  const app = useMemo(() => list.find((a) => a.ApplicationId === chosen) || null, [list, chosen]);
  const timeline = useQuery({
    queryKey: ["portal-timeline", chosen],
    queryFn: () => portal.timeline(chosen as number),
    enabled: chosen != null,
  });
  const money = useQuery({
    queryKey: ["portal-money", chosen],
    queryFn: () => portal.money(chosen as number),
    enabled: chosen != null,
  });
  const value: CustomerCtx = {
    me, apps, homes, past, app, appId: chosen, setAppId, timeline, money,
    readOnly: !!app?.IsCoApplicant || app?.Lifecycle === "Past",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomer(): CustomerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCustomer must be used within CustomerProvider");
  return c;
}
