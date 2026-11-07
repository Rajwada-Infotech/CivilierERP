import "./global.css";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/services/queryClient";
import { AuthProvider } from "@/auth/AuthContext";
import RootNavigator from "@/navigation/RootNavigator";
import { UpdateGate } from "@/updater/UpdateGate";
import { OtaUpdateGate } from "@/updater/OtaUpdateGate";
import { PushNotificationsGate } from "@/notifications/PushNotificationsGate";
import { navigationRef } from "@/navigation/navigationRef";
import { useAppFonts } from "@/theme/fonts";
import { ThemeProvider, ThemedTree, useTheme } from "@/theme/ThemeContext";

// A tapped notification opens the Approval Inbox (approvals) or Notifications
// (everything else). The app may have been closed, so wait briefly for the navigator.
function openFromNotification(data: Record<string, unknown>) {
  // "Update available": opening the app is enough — UpdateGate checks for the new build as the app comes forward.
  if (data?.type === "app-update") return;
  const screen = data?.type === "approval-waiting" || data?.type === "approval-outcome" ? "ApprovalInbox" : "Notifications";
  let tries = 0;
  const go = () => {
    if (navigationRef.isReady()) navigationRef.navigate(screen as never);
    else if (tries++ < 20) setTimeout(go, 250);
  };
  go();
}

/** Dark status-bar text on the light themes, light on Dark. */
function ThemedStatusBar() {
  const { light } = useTheme();
  return <StatusBar style={light ? "dark" : "light"} />;
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#0d0a1a" }}>
        <ActivityIndicator color="#7c3aed" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemedTree>
              <RootNavigator />
            </ThemedTree>
            <PushNotificationsGate appKey="admin" onOpen={openFromNotification} />
          </AuthProvider>
        </QueryClientProvider>
        <UpdateGate appKey="admin" />
        <OtaUpdateGate />
        <ThemedStatusBar />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
