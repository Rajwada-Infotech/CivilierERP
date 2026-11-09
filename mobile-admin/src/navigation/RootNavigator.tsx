import { DarkTheme, DefaultTheme, NavigationContainer, type NavigationState } from "@react-navigation/native";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import AuthStack from "./AuthStack";
import MainStack from "./MainStack";
import { NavSheet } from "./NavSheet";
import { navigationRef } from "./navigationRef";
import { colors } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeContext";

// The navigator's state, kept outside it: a theme switch remounts the navigator (ThemedTree) and it reopens on the page
// that was showing instead of the dashboard.
let savedState: NavigationState | undefined;
let savedFor: string | undefined; // whose session the saved state belongs to

export default function RootNavigator() {
  const { currentUser, isLoading } = useAuth();
  const { light } = useTheme();
  // Signing out, or in as someone else, starts the navigator afresh.
  if (savedFor !== currentUser?.id) {
    savedState = undefined;
    savedFor = currentUser?.id;
  }
  // The navigator's own backdrop (seen for a frame between pages) in the sheet's colours.
  const base = light ? DefaultTheme : DarkTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: colors.background, card: colors.card, text: colors.foreground, border: colors.border, primary: colors.primary } };

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
      theme={navTheme}
      initialState={currentUser ? savedState : undefined}
      onStateChange={(s) => {
        if (currentUser) savedState = s;
      }}
    >
      {currentUser ? (
        <>
          <MainStack />
          <NavSheet />
        </>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}
