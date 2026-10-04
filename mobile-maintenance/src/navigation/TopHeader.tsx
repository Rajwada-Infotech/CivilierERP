// Shared stack header — mirrors mobile-supplier's TopHeader.tsx exactly:
// animated logo on the left, notification bell (badge =
// useMaintenanceAlerts().alerts.length) and profile avatar on the right. No
// hamburger/menu button — there's nothing behind it yet (see MainStack.tsx),
// and Dashboard/Notifications/Profile are all reachable without one.
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Bell } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { useMaintenanceAlerts } from "@/hooks/useMaintenanceAlerts";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { navigate } from "./navigationRef";

const ACCENT = "#65a30d";

function initialsOf(name?: string) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TopHeader(_props: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const { alerts } = useMaintenanceAlerts();
  const alertCount = alerts.length;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}
    >
      <View className="flex-row items-center justify-between px-4 py-2.5">
        <View className="flex-1 min-w-0">
          <AnimatedLogo iconSize={28} />
        </View>

        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => navigate("Notifications")} style={{ padding: 2 }}>
            <View>
              <Bell size={20} color={colors.foreground} />
              {alertCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -4,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 8,
                    paddingHorizontal: 3,
                    backgroundColor: "#ef4444",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1.5,
                    borderColor: colors.background,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold, lineHeight: 11 }}>
                    {alertCount > 9 ? "9+" : alertCount}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>

          <Pressable onPress={() => navigate("Profile")}>
            <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: ACCENT }}>
              <Text style={{ color: "#1a1a1a", fontSize: 11, fontFamily: fonts.heading.bold }}>
                {initialsOf(currentUser?.name)}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
