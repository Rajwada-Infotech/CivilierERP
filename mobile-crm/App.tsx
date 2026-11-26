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
import { openNotification } from "@/navigation/navigationRef";
import { APP_KEY } from "@/services/appSession";
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";

// A tapped notification opens what it is about — an approval opens the Approval Inbox, a booking or ticket its own
// screen, anything else the Notifications screen (navigationRef.ts openNotification). The app may have been closed,
// so it waits briefly for the navigator to mount.
function openFromNotification(data?: Record<string, unknown>) {
  // "Update available": opening the app is enough — UpdateGate checks for the new build as the app comes forward.
  if (data?.type === "app-update") return;
  openNotification(data);
}

/** The signed-in app, redrawn when the theme changes (light / dark, accent) so every screen picks it up. */
function ThemedApp() {
  const { themeKey, mode } = useTheme();
  return (
    <>
      <View key={themeKey} style={{ flex: 1, backgroundColor: colors.background }}>
        <RootNavigator />
      </View>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <ThemedApp />
              <PushNotificationsGate appKey={APP_KEY} onOpen={openFromNotification} />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
        <UpdateGate appKey={APP_KEY} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
