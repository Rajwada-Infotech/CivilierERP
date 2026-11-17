import "./global.css";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/services/queryClient";
import { AuthProvider } from "@/auth/AuthContext";
import RootNavigator from "@/navigation/RootNavigator";
import { useAppFonts } from "@/theme/fonts";
import { ThemeProvider, ThemedTree, useTheme } from "@/theme/ThemeContext";

function ThemedStatusBar() {
  const { light } = useTheme();
  return <StatusBar style={light ? "dark" : "light"} />;
}

export default function App() {
  const [fontsLoaded] = useAppFonts();
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f1114" }}>
        <ActivityIndicator color="#6467f2" />
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
          </AuthProvider>
        </QueryClientProvider>
        <ThemedStatusBar />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
