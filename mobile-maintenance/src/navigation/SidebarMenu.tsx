// RN port of the web app's MobileNav.tsx nav-item-list styling — a
// module-colored FAB (bottom-right, same trigger idea as web's) opens a
// full-screen slide-up sheet listing every screen this app has: rounded
// rows with an icon chip, active-state accent border/background and a
// trailing dot, exactly like web MobileNav's `navItems.map(...)` block.
// This app is single-module (no module-switcher strip or Setup tab needed,
// unlike web's multi-module version) — just the plain nav list.
//
// Replaces BottomPillNav as this app's sole navigation surface: a
// single-tab pill bar stopped making sense once there were five real
// screens to reach.
import { useEffect, useState } from "react";
import { View, Text, Pressable, Modal, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Users, Receipt, ShieldCheck, Zap, Grip, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const ACCENT = "#65a30d";
const ACCENT_SOFT = "#bef264";

type NavRoute = keyof Pick<MainStackParamList, "Dashboard" | "Directory" | "Bills" | "Attendance" | "Electricity">;

const NAV_ITEMS: { route: NavRoute; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { route: "Dashboard", label: "Dashboard", icon: Home },
  { route: "Directory", label: "Customer Directory", icon: Users },
  { route: "Bills", label: "Maintenance Bills", icon: Receipt },
  { route: "Attendance", label: "Security Attendance", icon: ShieldCheck },
  { route: "Electricity", label: "Electricity Maintenance", icon: Zap },
];

export function SidebarMenu({ activeRoute }: { activeRoute: string }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const slide = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    Animated.timing(slide, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [open, slide]);

  const go = (route: NavRoute) => {
    setOpen(false);
    if (navigationRef.isReady() && route !== activeRoute) navigationRef.navigate(route);
  };

  return (
    <>
      {/* ── FAB trigger ─────────────────────────────────────────────────── */}
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          position: "absolute",
          right: 20,
          bottom: insets.bottom + 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 13,
          borderRadius: 16,
          backgroundColor: ACCENT,
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <Grip size={16} color="#0f1a04" />
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: "#0f1a04" }}>Menu</Text>
      </Pressable>

      {/* ── Full-screen slide-up sheet ──────────────────────────────────── */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }} onPress={() => setOpen(false)}>
          <Animated.View
            onStartShouldSetResponder={() => true}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "80%",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 12,
              transform: [
                {
                  translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
                },
              ],
              opacity: slide,
            }}
          >
            {/* Accent bar */}
            <View style={{ height: 3, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: ACCENT }} />

            {/* Drag handle */}
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
            </View>

            {/* Header row */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12 }}>
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.6 }}>
                Navigation
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}
              >
                <X size={13} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Nav items */}
            <View style={{ paddingHorizontal: 14, paddingBottom: 8, gap: 3 }}>
              {NAV_ITEMS.map((item) => {
                const active = item.route === activeRoute;
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.route}
                    onPress={() => go(item.route)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 11,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: active ? `${ACCENT}59` : "transparent",
                      backgroundColor: active ? `${ACCENT}1a` : "transparent",
                    }}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? `${ACCENT}26` : colors.muted,
                      }}
                    >
                      <Icon size={15} color={active ? ACCENT_SOFT : colors.mutedForeground} />
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 13.5,
                        fontFamily: active ? fonts.heading.semibold : fonts.body.medium,
                        color: active ? ACCENT_SOFT : colors.foreground,
                      }}
                    >
                      {item.label}
                    </Text>
                    {active && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ACCENT_SOFT }} />}
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}
