// Shared stack header — React Navigation reserves safe-area space above it
// automatically (this is what actually fixes content colliding with the
// phone's status bar/notch). Visually mirrors the web app's TopNavbar:
// logo + wordmark + live version string on the left, notification bell +
// user avatar on the right.
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/auth/adminAccess";
import { fetchInbox } from "@/api/approvalInboxApi";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { navigate } from "./navigationRef";

function initialsOf(name?: string) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TopHeader({ route }: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const isAdmin = useIsAdmin();

  // Bell badge — count of records currently awaiting this admin's approval,
  // same query the Approval Inbox screen itself uses (shared cache, so
  // opening the inbox doesn't trigger a second fetch).
  const { data: inboxItems } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    enabled: isAdmin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = inboxItems?.length ?? 0;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}
    >
      <View className="flex-row items-center justify-between px-4 py-2.5">
        <View className="flex-1 min-w-0">
          <AnimatedLogo iconSize={28} />
        </View>

        <View className="flex-row items-center gap-2.5">
          <Pressable
            onPress={() => navigate("Notifications")}
            className="w-8 h-8 rounded-full items-center justify-center"
            style={{ backgroundColor: `${colors.muted}` }}
          >
            <Bell size={15} color={colors.mutedForeground} />
            {pendingCount > 0 && (
              <View
                style={{
                  position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, paddingHorizontal: 3,
                  borderRadius: 8, backgroundColor: colors.destructive, alignItems: "center", justifyContent: "center",
                  borderWidth: 1.5, borderColor: colors.background,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold }}>{pendingCount > 99 ? "99+" : pendingCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => navigate("Profile")}>
            <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
              <Text style={{ color: "#fff", fontSize: 11, fontFamily: fonts.heading.bold }}>
                {initialsOf(currentUser?.name)}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
