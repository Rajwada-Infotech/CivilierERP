// Floating "+ New" action button, docked bottom-right above the pill nav.
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus } from "lucide-react-native";
import { fonts } from "@/theme/fonts";

export function Fab({ label = "New", onPress }: { label?: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: insets.bottom + 74 }}>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: "row", alignItems: "center", gap: 6,
          paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
          backgroundColor: "#eab308",
          shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10,
        }}
      >
        <Plus size={16} color="#1a1a1a" />
        <Text style={{ color: "#1a1a1a", fontSize: 13, fontFamily: fonts.heading.bold }}>{label}</Text>
      </Pressable>
    </View>
  );
}
