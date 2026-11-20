// Lets components outside the NavigationContainer (SidebarMenu, TopHeader)
// trigger navigation — same need the web app's MobileNav.tsx solves with
// react-router's useNavigate() from inside the tree; RN's overlay
// components sit outside it, so they need a ref instead.
import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainStackParamList } from "./MainStack";

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function navigate<RouteName extends keyof MainStackParamList>(
  name: RouteName,
  params?: MainStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as (name: string, params?: object) => void)(name, params);
  }
}

// ── Customer screens ─────────────────────────────────────────────────────────
// The customer's bottom tabs (Home, Payments, Bills, Help) live inside one stack screen, "CustomerTabs". A page outside
// the tab bar (My bookings, Profile, Settings) or the header's pop-ups can't open a tab by its bare name — React
// Navigation reports "The action 'NAVIGATE' … was not handled". openCustomerScreen routes a tab through CustomerTabs.
// The tab names come from the tab bar itself (CustomerStack.tsx registers them), so they are never listed twice.
let customerTabs = new Set<string>();
export function registerCustomerTabs(names: readonly string[]) { customerTabs = new Set(names); }

type Navigate = (name: string, params?: object) => void;
/** Open any customer screen by name, from anywhere: pass a screen's navigation.navigate, or nothing for the app-wide ref. */
export function openCustomerScreen(route: string, params?: object, via?: Navigate) {
  const go: Navigate = via || ((name, p) => { if (navigationRef.isReady()) (navigationRef.navigate as Navigate)(name, p); });
  if (customerTabs.has(route)) go("CustomerTabs", { screen: route, params });
  else go(route, params);
}

