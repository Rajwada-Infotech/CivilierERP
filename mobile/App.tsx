import "./global.css";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/services/queryClient";
import { AuthProvider } from "@/auth/AuthContext";
import RootNavigator from "@/navigation/RootNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
