// Mobile-native counterpart to SupplierLayout.tsx's floating center-top
// pill nav (web) — same emerald glass-pill identity (active tab lit
// emerald inside a dark glass capsule), but redesigned for a phone rather
// than shrunk to fit one: docked at the BOTTOM within thumb reach (a
// header pill is a reach-across-the-screen tap on a tall phone), and
// rendered as its own overlay sibling to the Stack navigator (same
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
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

export function BottomPillNav({ activeRoute }: { activeRoute: string }) {
  const insets = useSafeAreaInsets();

  // Only these three destinations are "tabs" — Profile (reached via the
  // header avatar) isn't part of this bar, same as the web nav's own
  // scope (its user dropdown is separate from the center pill too).
  if (!TABS.some((t) => t.route === activeRoute)) return null;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" }}>
      <View
        style={{
          flexDirection: "row",
          marginBottom: insets.bottom + 10,
          borderRadius: 999,
          padding: 4,
          backgroundColor: "rgba(15,17,26,0.90)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
          shadowColor: "#000",
          shadowOpacity: 0.45,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        {TABS.map((tab) => {
          const active = tab.route === activeRoute;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.route}
              onPress={() => {
                if (!active && navigationRef.isReady()) navigationRef.navigate(tab.route as never);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderRadius: 999,
                backgroundColor: active ? "rgba(16,185,129,0.14)" : "transparent",
                borderWidth: 1,
                borderColor: active ? "rgba(16,185,129,0.35)" : "transparent",
              }}
            >
              <Icon size={14} color={active ? "#6ee7b7" : "#818898"} />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: active ? fonts.heading.semibold : fonts.body.medium,
                  color: active ? "#6ee7b7" : "#818898",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
