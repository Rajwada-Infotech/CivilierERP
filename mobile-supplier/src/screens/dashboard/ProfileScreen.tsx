import { View, Text, Pressable } from "react-native";
import { useAuth } from "@/auth/AuthContext";

export default function ProfileScreen() {
  const { currentUser, logout } = useAuth();
  return (
    <View className="flex-1 bg-background px-6 pt-6">
      <Text className="text-foreground text-lg font-semibold">{currentUser?.name}</Text>
      <Text className="text-muted mb-6">{currentUser?.email}</Text>
      <Pressable
        onPress={() => logout()}
        className="bg-destructive rounded-lg py-3 items-center"
      >
        <Text className="text-white font-semibold">Sign Out</Text>
      </Pressable>
    </View>
  );
}
