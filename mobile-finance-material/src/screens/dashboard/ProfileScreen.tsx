import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { LogOut, Mail, Shield, Hash, KeyRound } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  user: "User",
  dba: "DBA",
  engineer: "Engineer",
  customer: "Customer",
  supplier: "Supplier",
  marketing_head: "Marketing Head",
  sales_team_lead: "Sales Team Lead",
  sales_person: "Sales Person",
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View className="flex-row items-start gap-3" style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.muted }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${colors.primary}1a`, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <Icon size={12} color={colors.primary} />
      </View>
      <View className="flex-1 min-w-0">
        <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>
          {label}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{value}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { currentUser, logout } = useAuth();
  const name = currentUser?.name ?? "User";
  const initials = currentUser?.initials || name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentUser ? ROLE_LABELS[currentUser.role] ?? currentUser.role : "";
  const isSuper = currentUser?.role === "super_admin";
  const pageCount = currentUser?.pagePermissions?.length ?? 0;

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need to log in again to continue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <LinearGradient
        colors={["#1e1b4b", "#312e81", colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 20, marginBottom: 16, overflow: "hidden" }}
      >
        <View className="flex-row items-center gap-4">
          <View style={{ width: 58, height: 58, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.20)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: "#fff" }}>{initials}</Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 }}>
              {role}
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: "#fff" }}>
              {name}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16, marginBottom: 16 }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 4 }}>Account</Text>
        <InfoRow icon={Mail} label="Email" value={currentUser?.email} />
        <InfoRow icon={Shield} label="Role" value={role} />
        <InfoRow icon={Hash} label="User ID" value={currentUser?.id} />
        <InfoRow
          icon={KeyRound}
          label="Access"
          value={isSuper ? "Full access to every page" : `${pageCount} page${pageCount === 1 ? "" : "s"} assigned`}
        />
      </View>

      <Pressable
        onPress={confirmSignOut}
        className="flex-row items-center justify-center gap-2"
        style={{ borderRadius: 12, borderWidth: 1, borderColor: `${colors.destructive}40`, backgroundColor: `${colors.destructive}14`, paddingVertical: 13 }}
      >
        <LogOut size={15} color="#f87171" />
        <Text style={{ fontSize: 13, fontFamily: fonts.body.semibold, color: "#f87171" }}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}
