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
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";

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
            <PushNotificationsGate appKey="cwd" onOpen={openFromNotification} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
      <UpdateGate appKey="cwd" />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
