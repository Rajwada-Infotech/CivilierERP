import { NavigationContainer } from "@react-navigation/native";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import AuthStack from "./AuthStack";
import MainTabs from "./MainTabs";

export default function RootNavigator() {
  const { currentUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {currentUser ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
