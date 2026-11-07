// The Menu sheet on the drawing sheet, as the finance app's (and the web's MobileNav) draws it, trimmed for a
// single-module app: no module strip to switch between (this app IS the Admin module), so the sheet opens straight
// into ADMIN_NAV_TREE. The trigger is a filled ink key at the bottom right; the sheet rises from the bottom under an ink
// rule with who is signed in (Profile, Sign out and Close keys), then the tree: leaves as ruled rows, groups that open
// to their children under an ink rule, the open page filled ink. Every leaf without a `nav` alerts "not built yet".
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grip, X, User, LogOut, ChevronRight } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Press } from "@/components/sheet/Sheet";
import { ADMIN_NAV_TREE } from "./adminNav";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

// The form pages have their own Save bar along the bottom; the menu key would sit on it, so it steps aside there.
const FORM_ROUTES = new Set<string>(["ApprovalSetupForm", "FinYearForm"]);

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

  // The group holding the open page starts expanded.
  useEffect(() => {
    if (!open) return;
    const g = ADMIN_NAV_TREE.find((i) => i.kind === "group" && i.children.some((c) => c.nav === activeRoute));
    if (g) setExpandedGroup(g.label);
  }, [open, activeRoute]);

  const openSheet = () => {
    setOpen(true);
    // A light spring settles with a touch of overshoot, closer to the phone's own sheets than a fixed ease.
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
  };
  const closeSheet = () => {
    // Closing stays a plain ease-in: an overshoot on the way out would read as the sheet coming back.
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };

  const go = (name: keyof MainStackParamList) => {
    if (navigationRef.isReady()) navigationRef.navigate(name as never);
    closeSheet();
  };
  const comingLater = (label: string) => Alert.alert(label, `The ${label} screen isn't built on mobile yet. Use the web app for now.`);

  const initials = (currentUser?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const row = (key: string, label: string, Icon: React.ComponentType<{ size?: number; color?: string }>, active: boolean, onPress: () => void, indent = false) => (
    <Press
      key={key}
      onPress={onPress}
      style={(pressed) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: indent ? 10 : 12,
        borderBottomWidth: 1,
        borderBottomColor: S.ruleSoft,
        backgroundColor: active ? S.ink : pressed ? S.blueWash : "transparent",
      })}
    >
      <Icon size={indent ? 14 : 16} color={active ? S.paper : indent ? S.graphite : S.ink} />
      <Text style={{ flex: 1, color: active ? S.paper : indent ? S.ink2 : S.ink, fontSize: indent ? 12.5 : 13, fontFamily: active ? fonts.body.semibold : fonts.body.medium }}>{label}</Text>
    </Press>
  );

  return (
    <>
      {/* The Menu key: a filled ink key, square, at the bottom right (not on a form page). */}
      {!(activeRoute && FORM_ROUTES.has(activeRoute)) && (
      <View style={{ position: "absolute", right: 16, bottom: insets.bottom + 16 }}>
        <Press
          onPress={openSheet}
          style={(pressed) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            minHeight: 44,
            backgroundColor: S.ink,
            borderWidth: 1,
            borderColor: S.ink,
            opacity: pressed ? 0.85 : 1,
            elevation: 6,
          })}
        >
          <Grip size={15} color={S.paper} />
          <Text style={{ color: S.paper, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>Menu</Text>
        </Press>
      </View>
      )}

      {/* animationType="none": `slide` alone drives the backdrop and the sheet, so the two move together. */}
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
              backgroundColor: S.paper,
              borderTopWidth: 1.5,
              borderTopColor: S.ink,
              overflow: "hidden",
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            }}
          >
            <Pressable onPress={() => {}}>
              {/* Who is signed in, with Profile, Sign out and Close keys. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                <View style={{ width: 36, height: 36, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initials}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{currentUser?.name}</Text>
                  <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular }}>{currentUser?.email}</Text>
                </View>
                {[
                  { key: "profile", Icon: User, ink: S.ink, onPress: () => go("Profile") },
                  { key: "logout", Icon: LogOut, ink: S.red, onPress: () => { closeSheet(); logout(); } },
                  { key: "close", Icon: X, ink: S.ink, onPress: closeSheet },
                ].map(({ key, Icon, ink, onPress }) => (
                  <Press
                    key={key}
                    onPress={onPress}
                    style={(pressed) => ({ width: 34, height: 34, borderWidth: 1, borderColor: ink, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? S.blueWash : "transparent" })}
                  >
                    <Icon size={15} color={ink} />
                  </Press>
                ))}
              </View>
              <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>CivilierERP · Admin</Text>
              </View>
            </Pressable>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {ADMIN_NAV_TREE.map((item) => {
                  if (item.kind === "leaf") {
                    return row(item.label, item.label, item.icon, !!item.nav && activeRoute === item.nav, () => (item.nav ? go(item.nav) : comingLater(item.label)));
                  }
                  const isExpanded = expandedGroup === item.label;
                  return (
                    <View key={item.label}>
                      <Press
                        onPress={() => setExpandedGroup(isExpanded ? null : item.label)}
                        style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                      >
                        <item.icon size={16} color={S.ink} />
                        <Text style={{ flex: 1, color: S.ink, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{item.label}</Text>
                        <ChevronRight size={14} color={S.graphite} style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }} />
                      </Press>
                      {isExpanded && (
                        <View style={{ marginLeft: 20, borderLeftWidth: 1, borderLeftColor: S.ink }}>
                          {item.children.map((child) =>
                            row(`${item.label}/${child.label}`, child.label, child.icon, !!child.nav && activeRoute === child.nav, () => (child.nav ? go(child.nav) : comingLater(child.label)), true),
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
