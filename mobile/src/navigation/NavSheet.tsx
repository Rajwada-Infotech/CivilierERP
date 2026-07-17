// RN port of the web app's MobileNav.tsx pattern — a floating trigger that
// opens a full nav panel, instead of a persistent tab bar. Scoped to what
// this app actually has: a "Navigation" list (Dashboard/Notifications/
// Profile, the web version's "Navigation" tab) and a module strip mirroring
// Home.tsx's access-gated module set (web's ModuleStrip/module chips) —
// tapping a module that has no mobile screen yet surfaces the same
// "not built on mobile yet" notice DashboardScreen's module cards use,
// rather than a dead route. The web version's Setup/Appearance tabs are
// dropped — there's no settings or theme-switching screen on mobile yet.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grip, X, User, LogOut, Home, Bell } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useModuleAccess, MODULE_LIST } from "./moduleAccess";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const NAV_ITEMS: Array<{ name: keyof MainStackParamList; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { name: "Dashboard", label: "Dashboard", icon: Home },
  { name: "Notifications", label: "Notifications", icon: Bell },
  { name: "Profile", label: "Profile", icon: User },
];

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const { access } = useModuleAccess();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

  // Pulsing glow behind the FAB — RN port of the web trigger's
  // `animate-pulse` blurred halo (MobileNav.tsx).
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const openSheet = () => {
    setOpen(true);
    Animated.timing(slide, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };
  const closeSheet = () => {
    Animated.timing(slide, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };

  const go = (name: keyof MainStackParamList) => {
    if (navigationRef.isReady()) navigationRef.navigate(name as never);
    closeSheet();
  };

  const goModule = (id: string, label: string) => {
    closeSheet();
    Alert.alert(label, `The ${label} module isn't built on mobile yet — use the web app for now.`);
  };

  const visibleModules = MODULE_LIST.filter((m) => access[m.id]);
  const initials = (currentUser?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* FAB trigger */}
      <View style={{ position: "absolute", right: 20, bottom: insets.bottom + 20 }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 20,
            backgroundColor: colors.primary,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }}
        />
        <Pressable onPress={openSheet}>
          <View
            className="flex-row items-center gap-2 px-4 py-3 rounded-2xl"
            style={{
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Grip size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Menu</Text>
          </View>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={closeSheet}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={closeSheet}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "85%",
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
              transform: [
                {
                  translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }),
                },
              ],
            }}
          >
            <Pressable onPress={() => {}}>
              <View style={{ height: 3, backgroundColor: colors.primary }} />

              {/* Drag handle */}
              <View className="items-center pt-2 pb-1">
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
              </View>

              {/* Header row */}
              <View className="flex-row items-center gap-2.5 px-4 py-3">
                <View
                  className="w-9 h-9 rounded-lg items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.bold }}>{initials}</Text>
                </View>
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                    {currentUser?.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                    {currentUser?.email}
                  </Text>
                </View>
                <Pressable
                  onPress={() => go("Profile")}
                  className="w-8 h-8 rounded-lg items-center justify-center"
                  style={{ borderWidth: 1, borderColor: colors.border }}
                >
                  <User size={15} color={colors.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    closeSheet();
                    logout();
                  }}
                  className="w-8 h-8 rounded-lg items-center justify-center"
                  style={{ borderWidth: 1, borderColor: `${colors.destructive}4d` }}
                >
                  <LogOut size={15} color={colors.destructive} />
                </Pressable>
                <Pressable
                  onPress={closeSheet}
                  className="w-8 h-8 rounded-lg items-center justify-center"
                  style={{ borderWidth: 1, borderColor: colors.border }}
                >
                  <X size={15} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {/* Module strip */}
              {visibleModules.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}
                >
                  {visibleModules.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => goModule(m.id, m.label)}
                      className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
                      style={{ borderWidth: 1, borderColor: colors.border }}
                    >
                      <m.icon size={13} color={m.accent} />
                      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{m.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </Pressable>

            {/* Navigation list */}
            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 4 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              <Text
                style={{ color: `${colors.mutedForeground}80`, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 1.5, marginBottom: 8 }}
              >
                NAVIGATION
              </Text>
              {NAV_ITEMS.map((item) => {
                const active = activeRoute === item.name;
                return (
                  <Pressable
                    key={item.name}
                    onPress={() => go(item.name)}
                    className="flex-row items-center gap-3 px-3 py-3 rounded-xl mb-1.5"
                    style={{
                      backgroundColor: active ? `${colors.primary}1f` : "transparent",
                      borderWidth: 1,
                      borderColor: active ? `${colors.primary}4d` : "transparent",
                    }}
                  >
                    <item.icon size={16} color={active ? colors.primary : colors.mutedForeground} />
                    <Text style={{ color: active ? colors.primary : colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}
