// Maintenance overview — scaffold placeholder. Once Directory/Bills/
// Security Attendance/Electricity Maintenance screens exist, rebuild this
// as stat cards + module links pulling from those APIs (already written
// in src/api/**), mirroring mobile-Fixed-Asset's DashboardScreen.tsx shape.
import { ScrollView, Text, View } from "react-native";
import { Wrench } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";
import { useAuth } from "@/auth/AuthContext";

const ACCENT = "#65a30d";

export default function DashboardScreen() {
  const { currentUser } = useAuth();

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
      <SectionLabel>Maintenance Overview</SectionLabel>
      <View
        style={{
          borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border,
          paddingVertical: 48, alignItems: "center", gap: 8,
        }}
      >
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: `${ACCENT}1f`, alignItems: "center", justifyContent: "center" }}>
          <Wrench size={22} color={ACCENT} />
        </View>
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>
          Welcome{currentUser?.name ? `, ${currentUser.name}` : ""}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, textAlign: "center", maxWidth: 280 }}>
          This is the scaffold — auth, navigation shell, and API clients for Customer Directory, Bills, Security Attendance and Electricity Maintenance are ready. Screens land here next.
        </Text>
      </View>
    </ScrollView>
  );
}
