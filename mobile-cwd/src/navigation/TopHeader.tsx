// Shared stack header, drawn as the sheet's title strip as the Admin app's is: the logo springs in turning from -180°,
// the version line matrix-scrambles between "APP. vX" and "DB. vY", and the logo and name go home. On the right, two
// square ink-ruled keys: the bell (opens Notifications; a red count of useCwdAlerts' alerts) and the profile key.
import { useEffect, useRef } from "react";
import { Animated, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Bell } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Press, motionOff } from "@/components/sheet/Sheet";
import { useAuth } from "@/auth/AuthContext";
import { useCwdAlerts } from "@/hooks/useCwdAlerts";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useMatrixCycle } from "@/hooks/useMatrixCycle";
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
function IconKey({ onPress, children, label }: { onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={(pressed) => ({ width: 36, height: 36, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      {children}
    </Press>
  );
}

/** The logo springs in, turning from -180° and growing from nothing (web: LogoIcon). */
function SpinInLogo() {
  const t = useRef(new Animated.Value(motionOff() ? 1 : 0)).current;
  useEffect(() => {
    if (motionOff()) return;
    Animated.spring(t, { toValue: 1, useNativeDriver: true, stiffness: 320, damping: 22 }).start();
  }, [t]);
  return (
    <Animated.View
      style={{
        width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: S.ink, backgroundColor: "#ffffff",
        alignItems: "center", justifyContent: "center", overflow: "hidden", opacity: t,
        transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-180deg", "0deg"] }) }, { scale: t }],
      }}
    >
      <Image source={require("../../assets/branding/Civilier.png")} style={{ width: 24, height: 24 }} resizeMode="contain" />
    </Animated.View>
  );
}

export function TopHeader(_props: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const { alerts } = useCwdAlerts();
  const alertCount = alerts.length;
  const { appVersion, dbVersion } = useAppVersion();
  const app = vee(appVersion);
  const db = vee(dbVersion);
  const version = useMatrixCycle(app === "…" || db === "…" ? ["…"] : [`APP. ${app.toUpperCase()}`, `DB. ${db.toUpperCase()}`]);

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.background, borderBottomWidth: 1.5, borderBottomColor: S.ink }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 }}>
        <Press
          onPress={() => navigate("Dashboard")}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel="Civil Work DPR home"
          style={(pressed) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.6 : 1 })}
        >
          <SpinInLogo />
          <View style={{ minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, letterSpacing: -0.4, color: S.ink }}>CivilierERP</Text>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 8.5, letterSpacing: 1, color: S.graphite, marginTop: 1, fontVariant: ["tabular-nums"] }}>{version}</Text>
          </View>
        </Press>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View>
            <IconKey onPress={() => navigate("Notifications")} label="Notifications">
              <Bell size={16} color={S.ink} />
            </IconKey>
            {alertCount > 0 && (
              <View
                pointerEvents="none"
                style={{ position: "absolute", top: -6, right: -6, minWidth: 17, height: 17, paddingHorizontal: 3, backgroundColor: S.red, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.background }}
              >
                <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold, lineHeight: 11 }}>{alertCount > 9 ? "9+" : alertCount}</Text>
              </View>
            )}
          </View>
          <IconKey onPress={() => navigate("Profile")} label="Profile">
            <Text style={{ color: S.ink, fontSize: 11, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initialsOf(currentUser?.name)}</Text>
          </IconKey>
        </View>
      </View>
    </SafeAreaView>
  );
}
