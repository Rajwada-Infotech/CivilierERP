import { View, Text } from "react-native";

// Placeholder — wire to the backend's notification endpoints + socket.io
// once the auth/query loop above is confirmed working (see AGENTS.md note
// on approval-driven push notifications in the mobile plan).
export default function NotificationsScreen() {
  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <Text className="text-foreground text-lg font-semibold mb-2">Notifications</Text>
      <Text className="text-muted text-center">
        Not wired up yet — connect to the backend's notification routes and
        socket.io once the core loop is verified.
      </Text>
    </View>
  );
}
