// Full module menu for the Fixed Asset app — mirrors the web app's
// FixedAssetSidebar. Every entry is gated by the same pageKey the web
// sidebar uses, so a user sees exactly the modules they can open on web.
import { ScrollView, Text, View, Pressable } from "react-native";
import {
  LayoutGrid,
  Boxes,
  Tag,
  DownloadCloud,
  UserCheck,
  ArrowLeftRight,
  ShieldCheck,
  Wrench,
  ChevronRight,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { PRIVILEGED_ROLES } from "@/auth/permissions";
import { navigate } from "@/navigation/navigationRef";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#eab308";

type Entry = {
  route: keyof MainStackParamList;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  pageKey: string;
};

const ENTRIES: Entry[] = [
  { route: "Dashboard", label: "Dashboard", desc: "Live counts & book value", icon: LayoutGrid, pageKey: "fixed-asset-dashboard" },
  { route: "AssetRegister", label: "Fixed Asset Depreciation Tag", desc: "Asset register & depreciation", icon: Boxes, pageKey: "fixed-asset-record" },
  { route: "Tagging", label: "FA Inventory", desc: "Tagged asset batches", icon: Tag, pageKey: "fixed-asset-tagging" },
  { route: "InventoryImport", label: "Inventory Import", desc: "Opening-stock imports", icon: DownloadCloud, pageKey: "fixed-asset-inventory-import" },
  { route: "Assignment", label: "Assignment", desc: "Who holds each asset", icon: UserCheck, pageKey: "fixed-asset-assignment" },
  { route: "AssetTransfer", label: "User-Wise Asset Transfer", desc: "Custody moves between users", icon: ArrowLeftRight, pageKey: "asset-transfer" },
  { route: "QualityCheck", label: "Owner & Quality Checking", desc: "Condition checks & follow-ups", icon: ShieldCheck, pageKey: "fixed-asset-quality-check" },
  { route: "Maintenance", label: "FA Maintenance & Repair", desc: "Repair vouchers & spend", icon: Wrench, pageKey: "fixed-asset-maintenance" },
];

export default function MenuScreen() {
  const { canAccessPage, currentUser } = useAuth();
  const privileged = PRIVILEGED_ROLES.includes((currentUser?.role ?? "user") as never);

  const visible = ENTRIES.filter((e) => privileged || canAccessPage(e.pageKey));

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
    >
      <Text
        style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}
      >
        Menu
      </Text>

      {visible.map((e) => {
        const Icon = e.icon;
        return (
          <Pressable
            key={e.route}
            onPress={() => navigate(e.route)}
            className="flex-row items-center gap-3"
            style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 8 }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(234,179,8,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Icon size={17} color={ACCENT} />
            </View>
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{e.label}</Text>
              <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{e.desc}</Text>
            </View>
            <ChevronRight size={16} color="#5c6270" />
          </Pressable>
        );
      })}

      {visible.length === 0 && (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
          You don't have access to any Fixed Asset modules.
        </Text>
      )}
    </ScrollView>
  );
}
