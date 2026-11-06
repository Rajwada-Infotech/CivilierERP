// Shared stack header, drawn as the sheet's title strip — React Navigation reserves safe-area space above it
// automatically. Logo, wordmark and version on the left; the notification bell (badge = useSupplierAlerts().alerts.length,
// the same client-derived list as web's bell — see useSupplierAlerts.ts) and the profile key on the right, both square
// ink-ruled keys.
import { View, Text, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Bell } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { useSupplierAlerts } from "@/hooks/useSupplierAlerts";
import { useAppVersion } from "@/hooks/useAppVersion";
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

const vee = (v: string) => (v === "…" || v === "—" ? v : v.startsWith("v") ? v : `v${v}`);

/** A square key, ink-ruled, that holds an icon or letters. */
function IconKey({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ width: 36, height: 36, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      {children}
    </Pressable>
  );
}

export function TopHeader(_props: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const { alerts } = useSupplierAlerts();
  const { appVersion, dbVersion, isLoading } = useAppVersion();
  const alertCount = alerts.length;

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.background, borderBottomWidth: 1.5, borderBottomColor: S.ink }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: S.ink, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <Image source={require("../../assets/branding/Civilier.png")} style={{ width: 24, height: 24 }} resizeMode="contain" />
          </View>
          <View style={{ minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, letterSpacing: -0.4, color: S.ink }}>CivilierERP</Text>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: S.graphite, marginTop: 1 }}>
              {isLoading ? "…" : `App ${vee(appVersion)} · DB ${vee(dbVersion)}`}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <IconKey onPress={() => navigate("Notifications")}>
            <Bell size={17} color={S.ink} />
            {alertCount > 0 && (
              <View style={{ position: "absolute", top: -6, right: -6, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: S.red, borderWidth: 1, borderColor: colors.background, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#ffffff", fontSize: 9, fontFamily: fonts.heading.bold, lineHeight: 11 }}>{alertCount > 9 ? "9+" : alertCount}</Text>
              </View>
            )}
          </IconKey>

          <IconKey onPress={() => navigate("Profile")}>
            <Text style={{ color: S.ink, fontSize: 11, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initialsOf(currentUser?.name)}</Text>
          </IconKey>
        </View>
      </View>
    </SafeAreaView>
  );
}
