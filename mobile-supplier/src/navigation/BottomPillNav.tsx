// Mobile-native counterpart to SupplierLayout.tsx's center-top nav (web): the three destinations as a tab strip docked
// at the BOTTOM within thumb reach, drawn on the sheet — a full-width bar under an ink rule, the tabs divided by
// hairlines, the open tab filled ink. Rendered as its own overlay sibling to the Stack navigator (same pattern
// mobile-admin's NavSheet uses) so it persists across screens without living inside any one of them.
//
// activeRoute comes down as a prop from RootNavigator (driven by NavigationContainer's own onStateChange) rather than
// this component reading navigationRef.getCurrentRoute()/addListener() itself — those throw "navigation object hasn't
// been initialized" if called before the container finishes attaching the ref, a race this component's own mount timing
// can lose (hit on Android, not in the web preview). navigationRef.navigate() below is still fine to call directly: by
// the time a tab is actually pressed, the container has long since mounted.
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FileSpreadsheet, ListChecks, ReceiptText } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
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

  // Only these three destinations are "tabs" — Profile (reached via the header key) isn't part of this bar, same as the
  // web nav's own scope (its user dropdown is separate from the center pill too).
  if (!TABS.some((t) => t.route === activeRoute)) return null;

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        backgroundColor: colors.background,
        borderTopWidth: 1.5,
        borderTopColor: S.ink,
        paddingBottom: insets.bottom,
      }}
    >
      {TABS.map((tab, i) => {
        const active = tab.route === activeRoute;
        const Icon = tab.icon;
        const fg = active ? colors.background : S.graphite;
        return (
          <Pressable
            key={tab.route}
            onPress={() => {
              if (!active && navigationRef.isReady()) navigationRef.navigate(tab.route as never);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 54,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              paddingVertical: 8,
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: S.rule,
              backgroundColor: active ? S.ink : pressed ? S.blueWash : "transparent",
            })}
          >
            <Icon size={16} color={fg} />
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: fg }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
