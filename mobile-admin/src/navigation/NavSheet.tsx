// RN port of mobile/'s NavSheet.tsx, trimmed for a single-module app — no
// module strip to switch between (this app IS the Admin module), so the
// sheet opens straight into ADMIN_NAV_TREE. Every leaf without a `nav`
// alerts "not built yet" until it gets a real screen.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grip, X, User, LogOut, ChevronRight } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ADMIN_NAV_TREE } from "./adminNav";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const openSheet = () => {
    setOpen(true);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
  };
  const closeSheet = () => {
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };

  const go = (name: keyof MainStackParamList) => {
    if (navigationRef.isReady()) navigationRef.navigate(name as never);
    closeSheet();
  };

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

      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
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
                { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
              ],
            }}
          >
            <Pressable onPress={() => {}}>
              <View style={{ height: 3, backgroundColor: colors.primary }} />

              <View className="items-center pt-2 pb-1">
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
              </View>

              <View className="flex-row items-center gap-2.5 px-4 py-3">
                <View className="w-9 h-9 rounded-lg items-center justify-center" style={{ backgroundColor: colors.primary }}>
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
            </Pressable>

            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 4 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              {ADMIN_NAV_TREE.map((item) => {
                if (item.kind === "leaf") {
                  const active = item.nav ? activeRoute === item.nav : false;
                  return (
                    <Pressable
                      key={item.label}
                      onPress={() => (item.nav ? go(item.nav) : Alert.alert(item.label, `The ${item.label} screen isn't built yet — use the web app for now.`))}
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
                }

                const isExpanded = expandedGroup === item.label;
                return (
                  <View key={item.label} className="mb-1.5">
                    <Pressable
                      onPress={() => setExpandedGroup(isExpanded ? null : item.label)}
                      className="flex-row items-center gap-3 px-3 py-3 rounded-xl"
                      style={{ backgroundColor: isExpanded ? `${colors.muted}80` : "transparent", borderWidth: 1, borderColor: isExpanded ? colors.border : "transparent" }}
                    >
                      <item.icon size={16} color={colors.mutedForeground} />
                      <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold, flex: 1 }}>{item.label}</Text>
                      <ChevronRight
                        size={14}
                        color={colors.mutedForeground}
                        style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
                      />
                    </Pressable>
                    {isExpanded && (
                      <View style={{ marginLeft: 20, marginTop: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: `${colors.primary}40` }}>
                        {item.children.map((child) => {
                          const childActive = child.nav ? activeRoute === child.nav : false;
                          return (
                            <Pressable
                              key={child.label}
                              onPress={() => (child.nav ? go(child.nav) : Alert.alert(child.label, `The ${child.label} screen isn't built yet — use the web app for now.`))}
                              className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-lg"
                            >
                              <child.icon size={14} color={childActive ? colors.primary : colors.mutedForeground} />
                              <Text style={{ color: childActive ? colors.primary : colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.medium }}>{child.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
