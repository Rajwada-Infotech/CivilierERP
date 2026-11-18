import "./global.css";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/services/queryClient";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import RootNavigator from "@/navigation/RootNavigator";
import { UpdateGate } from "@/updater/UpdateGate";
import { PushNotificationsGate } from "@/notifications/PushNotificationsGate";
import { navigationRef } from "@/navigation/navigationRef";
import { showApplication } from "@/customer/CustomerContext";
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";

// A tapped notification opens the app's Notifications screen (the app may have been
// closed, so wait briefly for the navigator to mount).
function openFromNotification(data?: Record<string, unknown>) {
  // "Update available": opening the app is enough — UpdateGate checks for the new build as the app comes forward.
  if (data?.type === "app-update") return;
  // A customer's: that property, on the screen the message is about (backend pushNotifications.js CUSTOMER_EVENTS).
  const portal = data?.type === "portal";
  if (portal && Number.isInteger(Number(data?.applicationId))) showApplication(Number(data?.applicationId));
  const screen = portal && typeof data?.screen === "string" ? data.screen : "Notifications";
  let tries = 0;
  const go = () => {
    if (navigationRef.isReady()) navigationRef.navigate(screen as never);
    else if (tries++ < 20) setTimeout(go, 250);
  };
  go();
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color="#eab308" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RootNavigator />
            <PushNotificationsGate appKey="maintenance" onOpen={openFromNotification} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
      <UpdateGate appKey="maintenance" />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
