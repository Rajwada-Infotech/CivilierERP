// Your account: who you are, what you can do in Civil Work DPR, change your password, sign out.
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, Hash, KeyRound, LogOut, Mail, Shield } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { changeMyPassword, getMyProfile } from "@/api/cwdApi";

const ACCENT = "#0891b2";
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", user: "User", dba: "DBA", engineer: "Engineer", customer: "Customer",
  supplier: "Supplier", marketing_head: "Marketing Head", sales_team_lead: "Sales Team Lead", sales_person: "Sales Person",
};
// The Civil Work DPR pages this app covers, with the label shown here.
const PAGES: { key: string; label: string }[] = [
  { key: "civilworkdpr-dashboard", label: "Dashboard" },
  { key: "civilworkdpr-work-done", label: "Work Allocation" },
  { key: "civilworkdpr-activity-reporting", label: "Work Reporting" },
  { key: "civilworkdpr-quality-check", label: "Quality Check" },
  { key: "civilworkdpr-work-transfer", label: "Work Transfer" },
];
const ACTION_LABEL: Record<string, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", reject: "Reject", export: "Export", print: "Print" };
const card = { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16, marginBottom: 16 } as const;

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.muted }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${ACCENT}1a`, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <Icon size={12} color={ACCENT} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{label}</Text>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{value}</Text>
      </View>
    </View>
  );
}

function PasswordField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, color: colors.foreground, fontSize: 13.5, fontFamily: fonts.body.regular }}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const { currentUser, logout } = useAuth();
  const name = currentUser?.name ?? "User";
  const initials = currentUser?.initials || name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentUser ? ROLE_LABELS[currentUser.role] ?? currentUser.role : "";
  const isSuper = currentUser?.role === "super_admin";
  const profileQ = useQuery({ queryKey: ["cwd-profile", currentUser?.id], queryFn: () => getMyProfile(currentUser!.id), enabled: !!currentUser?.id, staleTime: 300_000 });
  const since = profileQ.data?.created_datetime ? new Date(profileQ.data.created_datetime).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const pwError = next && next.length < 6 ? "New password must be at least 6 characters." : again && next !== again ? "The two new passwords don't match." : null;
  const change = useMutation({
    mutationFn: () => changeMyPassword(currentUser!.id, cur, next),
    onSuccess: () => { toast.success("Password changed"); setCur(""); setNext(""); setAgain(""); setPwOpen(false); },
    onError: (e: Error) => Alert.alert("Couldn't change the password", e.message),
  });

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need to log in again to continue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);

  const rights = (key: string) => (isSuper ? null : currentUser?.pagePermissions?.find((p) => p.page === key)?.actions ?? []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <LinearGradient colors={["#083344", "#0e7490", ACCENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 18, padding: 20, marginBottom: 16, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <View style={{ width: 58, height: 58, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: "#fff" }}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 }}>{role}</Text>
            <Text numberOfLines={2} style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: "#fff" }}>{name}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={card}>
        <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 4 }}>Account</Text>
        <InfoRow icon={Mail} label="Email" value={currentUser?.email} />
        <InfoRow icon={Shield} label="Role" value={role} />
        <InfoRow icon={Hash} label="User ID" value={currentUser?.id} />
        <InfoRow icon={Calendar} label="Member since" value={since} />
      </View>

      <View style={card}>
        <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 10 }}>Your access in Civil Work DPR</Text>
        {isSuper && <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 6 }}>Super admin — full access to every page.</Text>}
        {PAGES.map((pg) => {
          const actions = rights(pg.key);
          const has = actions === null || actions.length > 0;
          return (
            <View key={pg.key} style={{ paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.muted, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: has ? colors.foreground : colors.mutedForeground }}>{pg.label}</Text>
                {!has && <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>No access</Text>}
              </View>
              {has && actions !== null && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                  {actions.map((a) => (
                    <View key={a} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: `${ACCENT}1f` }}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: ACCENT }}>{ACTION_LABEL[a] ?? a}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={card}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setPwOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <KeyRound size={15} color={ACCENT} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.bold, color: colors.foreground }}>Change password</Text>
          <ChevronRight size={15} color={colors.mutedForeground} style={{ transform: [{ rotate: pwOpen ? "90deg" : "0deg" }] }} />
        </TouchableOpacity>
        {pwOpen && (
          <View style={{ marginTop: 14 }}>
            <PasswordField label="Current password" value={cur} onChangeText={setCur} />
            <PasswordField label="New password" value={next} onChangeText={setNext} />
            <PasswordField label="Confirm new password" value={again} onChangeText={setAgain} />
            {!!pwError && <Text style={{ fontSize: 11, color: colors.destructive, fontFamily: fonts.body.regular, marginBottom: 10 }}>{pwError}</Text>}
            <TouchableOpacity
              disabled={!cur || next.length < 6 || next !== again || change.isPending}
              onPress={() => change.mutate()}
              style={{ alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: ACCENT, opacity: !cur || next.length < 6 || next !== again || change.isPending ? 0.4 : 1 }}
            >
              {change.isPending ? <ActivityIndicator size="small" color="#04181d" /> : <Text style={{ fontFamily: fonts.heading.bold, fontSize: 12, color: "#04181d" }}>Update password</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={confirmSignOut}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: `${colors.destructive}40`, backgroundColor: `${colors.destructive}14`, paddingVertical: 13 }}
      >
        <LogOut size={15} color="#f87171" />
        <Text style={{ fontSize: 13, fontFamily: fonts.body.semibold, color: "#f87171" }}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
