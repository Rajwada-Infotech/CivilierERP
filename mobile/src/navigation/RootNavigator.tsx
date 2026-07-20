import { NavigationContainer } from "@react-navigation/native";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import AuthStack from "./AuthStack";
import MainStack from "./MainStack";
import { NavSheet } from "./NavSheet";
import { navigationRef } from "./navigationRef";
import { colors } from "@/theme/colors";

export default function RootNavigator() {
  const { currentUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
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
