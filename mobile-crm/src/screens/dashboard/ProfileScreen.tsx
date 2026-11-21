// The More tab: who is signed in (name, email, role, the parts of the app their rights open), notifications, the app
// itself (installed version, check for update), changing their own password (the web profile's route,
// backend/routes/userProfile.js) and signing out.
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Application from "expo-application";
import { Bell, KeyRound, LogOut, RefreshCw } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { checkForUpdateNow } from "@/updater/UpdateGate";
import { useAppVersion } from "@/hooks/useAppVersion";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { useHasCrm } from "@/screens/crm/CrmHubScreen";
import { useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import { useBellCount } from "@/screens/notifications/NotificationsScreen";
import { Kv, LinkRow, Section } from "@/screens/crm/ui";

const CRM = moduleAccents.crm;
const roleText = (r?: string) => (r || "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} secureTextEntry autoCapitalize="none" autoCorrect={false}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13.5 }} />
    </View>
  );
}

function ChangePassword({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!cur || !next) return setError("Enter your current and new password.");
    if (next.length < 6) return setError("The new password must be at least 6 characters.");
    if (next !== again) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      const res = await fetchWithAuth(`/api/user-profile/${userId}/change-password`, {
        method: "POST", body: JSON.stringify({ current_password: cur, new_password: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not change the password.");
      toast.success("Password changed");
      setCur(""); setNext(""); setAgain(""); setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <LinkRow title="Change password" icon={KeyRound} onPress={() => setOpen(true)} />;
  return (
    <View style={{ paddingVertical: 8 }}>
      <PasswordInput label="Current password" value={cur} onChange={setCur} />
      <PasswordInput label="New password" value={next} onChange={setNext} />
      <PasswordInput label="New password again" value={again} onChange={setAgain} />
      {error ? <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, marginBottom: 8 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={() => { setOpen(false); setError(null); }} style={{ flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 13 }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={busy} style={{ flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: CRM, opacity: busy ? 0.6 : 1 }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 13 }}>Change password</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function MoreScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { currentUser, logout, canAccessPage } = useAuth();
  const { appVersion } = useAppVersion();
  const bell = useBellCount();
  const [checking, setChecking] = useState(false);
  const opens = [
    useHasCrm() && "CRM",
    canAccessPage("approval-inbox") && "Approvals",
    useHasMaintenance() && "Maintenance",
  ].filter(Boolean).join(", ");

  const checkUpdate = async () => {
    if (Platform.OS !== "android") return toast.info("Updates are installed from the Android app.");
    setChecking(true);
    const r = await checkForUpdateNow();
    setChecking(false);
    if (r === "latest") toast.success("You have the latest version.");
    else if (r === "unavailable") toast.error("Couldn't check for updates. Check your connection.");
  };

  const signOut = () => {
    if (Platform.OS === "web") { logout(); return; }
    Alert.alert("Sign out?", "You'll need your email and password to sign in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: CRM, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 18, fontFamily: fonts.heading.bold }}>{currentUser?.initials}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>{currentUser?.name}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{currentUser?.email}</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: CRM, marginTop: 4 }}>{roleText(currentUser?.role)}</Text>
        </View>
      </View>

      <Section title="Your access">
        <Kv label="You can open" value={opens || "Home only"} />
        <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingBottom: 6 }}>
          Set by your Menu Rights on the web. Ask your admin to change them.
        </Text>
      </Section>

      <Section title="Notifications">
        <LinkRow title="Notifications" sub={bell ? `${bell} need attention` : "All caught up"} icon={Bell} onPress={() => nav.navigate("Notifications")} />
      </Section>

      <Section title="App">
        <Kv label="Installed" value={Application.nativeApplicationVersion ? `${Application.nativeApplicationVersion} (${Application.nativeBuildVersion})` : "—"} />
        <Kv label="Server" value={appVersion && appVersion !== "…" ? appVersion : "—"} />
        <LinkRow title={checking ? "Checking…" : "Check for update"} icon={RefreshCw} onPress={checking ? undefined : checkUpdate} />
      </Section>

      <Section title="Account">
        {currentUser ? <ChangePassword userId={currentUser.id} /> : null}
      </Section>

      <Pressable onPress={signOut} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: `${colors.destructive}66`, opacity: pressed ? 0.7 : 1 })}>
        <LogOut size={16} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontFamily: fonts.heading.semibold, fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
