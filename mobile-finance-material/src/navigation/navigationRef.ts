// Lets components outside the NavigationContainer (the global nav sheet
// overlay, rendered by RootNavigator alongside the Stack) trigger
// navigation — same need the web app's MobileNav.tsx solves with
// react-router's useNavigate() from inside the tree; RN's nav sheet sits
// outside it, so it needs a ref instead.
import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainStackParamList } from "./MainStack";

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function navigate(name: keyof MainStackParamList) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as never);
  }
}
