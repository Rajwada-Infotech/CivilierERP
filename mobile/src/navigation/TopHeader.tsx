// Shared stack header — React Navigation reserves safe-area space above it
// automatically (this is what actually fixes content colliding with the
// phone's status bar/notch), unlike the plain ScrollView the screens used
// before. Visually mirrors the web app's TopNavbar at its minimal mobile
// footprint: small wordmark + the current screen's title.
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function TopHeader({ options, route }: NativeStackHeaderProps) {
  const title = options.title ?? route.name;
  return (
    <SafeAreaView
      edges={["top"]}
      style={{
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: `${colors.border}80`,
      }}
    >
      <View className="flex-row items-center justify-between px-4" style={{ height: 48 }}>
        <View className="flex-row items-center gap-2">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 2 }}>
            CIVILIERERP
          </Text>
        </View>
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{title}</Text>
      </View>
    </SafeAreaView>
  );
}
