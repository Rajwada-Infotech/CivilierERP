// Shared stack header, drawn as the sheet's title strip — React Navigation reserves safe-area space above it
// automatically (this is what keeps content clear of the status bar / notch). As the web's TopNavbar / LogoFull:
// the logo springs in turning from -180°, the version line matrix-scrambles between "APP. vX" and "DB. vY" every 5s,
// and the profile key shows the user's photo (fetched from their profile, as web's AuthContext does) or initials.
// The bell and the profile key are square ink-ruled keys.
import { useEffect, useRef, useState } from "react";
import { View, Text, Image, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Press, motionOff } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useMatrixCycle } from "@/hooks/useMatrixCycle";
import { useAuthImageSource } from "@/components/AuthImage";
import { fetchWithAuth } from "@/services/fetchWithAuth";
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

/** A square key, ink-ruled, that holds an icon, letters or a photo. */
function IconKey({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ width: 36, height: 36, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: pressed ? S.blueWash : "transparent" })}
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
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: S.ink,
        backgroundColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: t,
        transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-180deg", "0deg"] }) }, { scale: t }],
      }}
    >
      <Image source={require("../../assets/branding/Civilier.png")} style={{ width: 24, height: 24 }} resizeMode="contain" />
    </Animated.View>
  );
}

/** The signed-in user's profile photo, as the web navbar reads it: /api/user-profile/:id/profile → avatar_url. */
function useAvatarUrl(userId?: string) {
  const { data } = useQuery({
    queryKey: ["user-avatar", userId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/user-profile/${userId}/profile`);
      if (!res.ok) return null;
      const j = await res.json().catch(() => ({}));
      return (j?.avatar_url as string | null) ?? null;
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });
  return data ?? null;
}

export function TopHeader(_props: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const { appVersion, dbVersion } = useAppVersion();
  const app = vee(appVersion ?? "…");
  const db = vee(dbVersion);
  const version = useMatrixCycle(app === "…" || db === "…" ? ["…"] : [`APP. ${app.toUpperCase()}`, `DB. ${db.toUpperCase()}`]);
  const avatarUrl = useAvatarUrl(currentUser?.id);
  const avatar = useAuthImageSource(avatarUrl);
  // A picture that won't draw falls back to the initials rather than leaving the key blank.
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [avatarUrl]);

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.background, borderBottomWidth: 1.5, borderBottomColor: S.ink }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <SpinInLogo />
          <View style={{ minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, letterSpacing: -0.4, color: S.ink }}>CivilierERP</Text>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 8.5, letterSpacing: 1, color: S.graphite, marginTop: 1, fontVariant: ["tabular-nums"] }}>{version}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <IconKey onPress={() => navigate("Notifications")}>
            <Bell size={17} color={S.ink} />
          </IconKey>
          <IconKey onPress={() => navigate("Profile")}>
            {avatar && !avatarFailed ? (
              <Image
                source={avatar}
                style={{ width: 34, height: 34 }}
                resizeMode="cover"
                onError={(e) => {
                  console.warn("[header] profile photo could not be shown:", e.nativeEvent?.error);
                  setAvatarFailed(true);
                }}
              />
            ) : (
              <Text style={{ color: S.ink, fontSize: 11, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initialsOf(currentUser?.name)}</Text>
            )}
          </IconKey>
        </View>
      </View>
    </SafeAreaView>
  );
}
