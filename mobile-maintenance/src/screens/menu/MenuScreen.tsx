// Hamburger-reached module list — scaffold state, no modules built yet.
// Once Directory/Bills/Attendance/Electricity screens exist, list them
// here gated by canAccessPage (same pattern as mobile-Fixed-Asset's
// MenuScreen.tsx).
import { ScrollView, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";

export default function MenuScreen() {
  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
      <SectionLabel>Maintenance Modules</SectionLabel>
      <View
        style={{
          borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border,
          paddingVertical: 40, alignItems: "center", gap: 6,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>
          Nothing here yet
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, textAlign: "center", maxWidth: 260 }}>
          Customer Directory, Bills, Security Attendance and Electricity Maintenance screens land here as they're built.
        </Text>
      </View>
    </ScrollView>
  );
}
