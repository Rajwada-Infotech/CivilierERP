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
import { getStoredUser } from "@/services/authStorage";
import { openIncomingCall } from "@/screens/calls/IncomingCallWatcher";

// A tapped notification opens the app's Notifications screen (the app may have been
// closed, so wait briefly for the navigator to mount).
function openFromNotification(data?: Record<string, unknown>) {
  // "Update available": opening the app is enough — UpdateGate checks for the new build as the app comes forward.
  if (data?.type === "app-update") return;
  let tries = 0;
  const go = async () => {
    if (!navigationRef.isReady()) {
      if (tries++ < 20) setTimeout(go, 250);
      return;
    }
    // An incoming call: straight to its answer screen.
    const callId = Number(data?.callId);
    if (data?.type === "security-call" && callId) {
      openIncomingCall(callId);
      return;
    }
    // A complaint: the resident sees the answer, the security admin the list.
    if (data?.type === "security-complaint") {
      const user = await getStoredUser<{ kind?: string }>();
      navigationRef.navigate(user?.kind === "customer" ? "Complaints" : "AdminComplaints");
      return;
    }
    // A visitor request: the resident opens it to approve or deny; the guard opens its answer.
    const requestId = Number(data?.requestId);
    if (data?.type === "security-visitor" && requestId) {
      const user = await getStoredUser<{ kind?: string }>();
      if (user?.kind === "customer") navigationRef.navigate("VisitorDecision", { id: requestId });
      else navigationRef.navigate("VisitorStatus", { id: requestId });
      return;
    }
    navigationRef.navigate("Notifications" as never);
  };
  void go();
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
            <PushNotificationsGate appKey="security-intercom" onOpen={openFromNotification} />
          </AuthProvider>
        </QueryClientProvider>
        <UpdateGate appKey="security-intercom" />
        <OtaUpdateGate />
      </ErrorBoundary>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
