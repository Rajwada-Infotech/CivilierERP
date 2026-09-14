// Reports hub for the Fixed Asset app — mirrors the web app's
// Reports → Fixed Asset section. Every report is FA Item Code wise.
import { ScrollView, Text, View, Pressable } from "react-native";
import { TrendingUp, UserCheck, Wrench, ArrowLeftRight, ChevronRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { navigate } from "@/navigation/navigationRef";
import type { ReportKey } from "./reportConfig";

const ACCENT = "#eab308";

const CARDS: {
  key: ReportKey;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}[] = [
  { key: "depreciation", label: "Total Depreciation", desc: "Posted depreciation & book value per FA Item Code", icon: TrendingUp },
  { key: "owner", label: "FA Owner / Custodian", desc: "Current custodian, department & location per FA Item Code", icon: UserCheck },
  { key: "maintenance", label: "FA Maintenance & Repair", desc: "Repair spend per FA Item Code — vendor, type & total", icon: Wrench },
  { key: "transfer", label: "Asset Transfer Report", desc: "Custody transfers between users, FA Item Code wise", icon: ArrowLeftRight },
];

export default function ReportsScreen() {
  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
    >
      <Text
        style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}
      >
        Fixed Asset Reports
      </Text>

      {CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <Pressable
            key={c.key}
            onPress={() => navigate("ReportView", { report: c.key })}
            className="flex-row items-center gap-3"
            style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 8 }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(234,179,8,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Icon size={17} color={ACCENT} />
            </View>
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{c.label}</Text>
              <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{c.desc}</Text>
            </View>
            <ChevronRight size={16} color="#5c6270" />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
