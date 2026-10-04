import "./global.css";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/services/queryClient";
import { AuthProvider } from "@/auth/AuthContext";
import RootNavigator from "@/navigation/RootNavigator";
import { UpdateGate } from "@/updater/UpdateGate";
import { PushNotificationsGate } from "@/notifications/PushNotificationsGate";
import { navigationRef } from "@/navigation/navigationRef";
import { OtaUpdateGate } from "@/updater/OtaUpdateGate";
import { useAppFonts } from "@/theme/fonts";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// A tapped notification opens the app's Notifications screen (the app may have been
// closed, so wait briefly for the navigator to mount).
function openFromNotification() {
  let tries = 0;
  const go = () => {
    if (navigationRef.isReady()) navigationRef.navigate("Notifications" as never);
    else if (tries++ < 20) setTimeout(go, 250);
  };
  go();
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
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
            <PushNotificationsGate appKey="finance-material" onOpen={openFromNotification} />
          </AuthProvider>
        </QueryClientProvider>
        <UpdateGate appKey="finance-material" />
        <OtaUpdateGate />
      </ErrorBoundary>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
