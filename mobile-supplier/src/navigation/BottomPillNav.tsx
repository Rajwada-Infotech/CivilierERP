// Mobile-native counterpart to SupplierLayout.tsx's floating center-top
// pill nav (web) — same emerald glass-pill identity: dot-grid texture +
// emerald radial glow baked into the capsule, active tab lit emerald with
// a soft glow, transitions animated rather than snapping. Redesigned for a
// phone rather than shrunk to fit one: docked at the BOTTOM within thumb
// reach (a header pill is a reach-across-the-screen tap on a tall phone),
// and rendered as its own overlay sibling to the Stack navigator (same
// pattern mobile-admin's NavSheet uses) so it persists across screens
// without living inside any one of them.
//
// activeRoute comes down as a prop from RootNavigator (driven by
// NavigationContainer's own onStateChange) rather than this component
// reading navigationRef.getCurrentRoute()/addListener() itself — those
// throw "navigation object hasn't been initialized" if called before the
// container finishes attaching the ref, a race this component's own
// mount timing can lose (hit on Android, not in the web preview).
// navigationRef.navigate() below is still fine to call directly: by the
// time a tab is actually pressed, the container has long since mounted.
import { useEffect, useRef, useState } from "react";
import { Animated, LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { FileSpreadsheet, ListChecks, ReceiptText } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const TABS: {
  route: keyof MainStackParamList;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}[] = [
  { route: "Dashboard", label: "Quotations", icon: FileSpreadsheet },
  { route: "Catalog", label: "Price Catalog", icon: ListChecks },
  { route: "CreditNotes", label: "Credit Notes", icon: ReceiptText },
];

// Same emerald glass identity as web's .sup-nav-pill / .sup-nav-pill--active
// CSS (SupplierLayout.tsx): transparent → tinted-emerald background/border/
// text, cross-faded rather than snapped — web does that with a 150ms CSS
// transition, this is its Animated equivalent.
function TabButton({
  route,
  label,
  icon: Icon,
  active,
  onPress,
}: {
  route: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  active: boolean;
  onPress: () => void;
}) {
  const t = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: active ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [active, t]);

  const backgroundColor = t.interpolate({ inputRange: [0, 1], outputRange: ["rgba(16,185,129,0)", "rgba(16,185,129,0.14)"] });
  const borderColor = t.interpolate({ inputRange: [0, 1], outputRange: ["rgba(16,185,129,0)", "rgba(16,185,129,0.35)"] });
  const fg = t.interpolate({ inputRange: [0, 1], outputRange: ["#818898", "#6ee7b7"] });

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 9,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor,
          borderWidth: 1,
          borderColor,
        }}
      >
        <Icon size={14} color={active ? "#6ee7b7" : "#818898"} />
        <Animated.Text style={{ fontSize: 12, fontFamily: active ? fonts.heading.semibold : fonts.body.medium, color: fg }}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function BottomPillNav({ activeRoute }: { activeRoute: string }) {
  const insets = useSafeAreaInsets();
  const [pillSize, setPillSize] = useState({ width: 0, height: 0 });
  const onPillLayout = (e: LayoutChangeEvent) => setPillSize(e.nativeEvent.layout);

  // Only these three destinations are "tabs" — Profile (reached via the
  // header avatar) isn't part of this bar, same as the web nav's own
  // scope (its user dropdown is separate from the center pill too).
  if (!TABS.some((t) => t.route === activeRoute)) return null;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" }}>
      <View
        onLayout={onPillLayout}
        style={{
          flexDirection: "row",
          marginBottom: insets.bottom + 10,
          borderRadius: 999,
          padding: 4,
          backgroundColor: "rgba(15,17,26,0.90)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.13)",
          shadowColor: "#000",
          shadowOpacity: 0.45,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
          overflow: "hidden",
        }}
      >
        {/* Dot grid + emerald glow — same textured-glass identity as web's
            pill (radial-gradient dot pattern + emerald radial glow at top). */}
        {pillSize.width > 0 && (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
            <Svg width={pillSize.width} height={pillSize.height}>
              <Defs>
                <Pattern id="dots" width={14} height={14} patternUnits="userSpaceOnUse">
                  <Circle cx={1} cy={1} r={1} fill="rgba(255,255,255,0.10)" />
                </Pattern>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#dots)" />
            </Svg>
            <LinearGradient
              colors={["rgba(16,185,129,0.30)", "rgba(16,185,129,0.08)", "rgba(16,185,129,0)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: "absolute", inset: 0 }}
            />
          </View>
        )}

        <View style={{ flexDirection: "row" }}>
          {TABS.map((tab) => {
            const active = tab.route === activeRoute;
            return (
              <TabButton
                key={tab.route}
                route={tab.route}
                label={tab.label}
                icon={tab.icon}
                active={active}
                onPress={() => {
                  if (!active && navigationRef.isReady()) navigationRef.navigate(tab.route as never);
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}
