import { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import AuthStack from "./AuthStack";
import MainStack from "./MainStack";
import { BottomPillNav } from "./BottomPillNav";
import { navigationRef } from "./navigationRef";
import { colors } from "@/theme/colors";

export default function RootNavigator() {
  const { currentUser, isLoading } = useAuth();
  // Dashboard is MainStack's initial route, so this is accurate before the
  // container's own state exists — see BottomPillNav.tsx for why this
  // isn't read from navigationRef directly.
  const [activeRoute, setActiveRoute] = useState("Dashboard");

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={() => {
        // isReady() is the one navigationRef method safe to call before
        // attachment (per React Navigation's own docs) — onStateChange's
        // very first firing can still race the ref attaching, so every
        // other method (getCurrentRoute included) stays behind this guard.
        if (navigationRef.isReady()) setActiveRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard");
      }}
    >
      {currentUser ? (
        <>
          <MainStack />
          <BottomPillNav activeRoute={activeRoute} />
        </>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}
