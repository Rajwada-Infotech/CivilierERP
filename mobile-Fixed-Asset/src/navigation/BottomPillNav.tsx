// Bottom-docked glass pill nav — same pattern as mobile-supplier's, docked
// within thumb reach and rendered as an overlay sibling to the Stack
// navigator so it persists across screens. `activeRoute` comes down as a
// prop from RootNavigator (driven by NavigationContainer's onStateChange).
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LayoutGrid, Boxes, Wrench, BarChart3 } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const ACCENT = "#eab308";
const ACCENT_SOFT = "#fde68a";

const TABS: {
  route: keyof MainStackParamList;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}[] = [
  { route: "Dashboard", label: "Overview", icon: LayoutGrid },
  { route: "AssetRegister", label: "Assets", icon: Boxes },
  { route: "Maintenance", label: "Repairs", icon: Wrench },
  { route: "Reports", label: "Reports", icon: BarChart3 },
];

export function BottomPillNav({ activeRoute }: { activeRoute: string }) {
  const insets = useSafeAreaInsets();

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
                gap: 5,
                paddingVertical: 9,
                paddingHorizontal: 11,
                borderRadius: 999,
                backgroundColor: active ? "rgba(234,179,8,0.14)" : "transparent",
                borderWidth: 1,
                borderColor: active ? "rgba(234,179,8,0.35)" : "transparent",
              }}
            >
              <Icon size={14} color={active ? ACCENT_SOFT : "#818898"} />
              <Text
                style={{
                  fontSize: 11.5,
                  fontFamily: active ? fonts.heading.semibold : fonts.body.medium,
                  color: active ? ACCENT_SOFT : "#818898",
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
