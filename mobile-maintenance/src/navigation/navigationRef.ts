// Lets components outside the NavigationContainer (BottomPillNav, TopHeader)
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
