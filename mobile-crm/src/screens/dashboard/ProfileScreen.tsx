// The account pages from the avatar menu, laid out like Civilier Home's (My profile, Settings):
//   ProfileScreen   who is signed in, what their rights open, and changing their own password (the web profile's route,
//                   backend/routes/userProfile.js);
//   SettingsScreen  Appearance (dark mode and the accent colour, kept on this phone) and the app (installed version,
//                   check for update).
// Signing out is the avatar menu's.
import { useState } from "react";
import { Platform, Switch, Text, TextInput, View } from "react-native";
import * as Application from "expo-application";
import { Check, KeyRound, RefreshCw } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { roleText } from "@/navigation/TopHeader";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { checkForUpdateNow } from "@/updater/UpdateGate";
import { useAppVersion } from "@/hooks/useAppVersion";
import { ACCENTS, useBrand, useTheme, type AccentKey } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { useHasCrm } from "@/screens/crm/crmRegisters";
import { useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import { AccentAvatar, Button, HeroSurface, Kv, LinkRow, ON_HERO, Page, Section, Tap } from "@/screens/crm/ui";

function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const b = useBrand();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} secureTextEntry autoCapitalize="none" autoCorrect={false}
        style={{ borderRadius: 14, backgroundColor: b.surfaceGlass, paddingHorizontal: 14, paddingVertical: 12, color: b.textPrimary, fontFamily: fonts.body.regular, fontSize: 15 }} />
    </View>
  );
}

function ChangePassword({ userId }: { userId: string }) {
  const b = useBrand();
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
    <View style={{ gap: 12, paddingVertical: 8 }}>
      <PasswordInput label="Current password" value={cur} onChange={setCur} />
      <PasswordInput label="New password" value={next} onChange={setNext} />
      <PasswordInput label="New password again" value={again} onChange={setAgain} />
      {error ? <Text style={{ color: b.danger, fontSize: 13, fontFamily: fonts.body.medium }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" kind="line" onPress={() => { setOpen(false); setError(null); }} /></View>
        <View style={{ flex: 1 }}><Button label="Save" onPress={save} busy={busy} /></View>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const b = useBrand();
  const { currentUser, canAccessPage } = useAuth();
  const hasCrm = useHasCrm();
  const hasMaintenance = useHasMaintenance();
  const opens = [hasCrm && "CRM", canAccessPage("approval-inbox") && "Approvals", hasMaintenance && "Maintenance"].filter(Boolean).join(", ");
  const initials = (currentUser?.name || "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <Page gap={0}>
      <View style={{ marginBottom: 14 }}>
        <HeroSurface>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <AccentAvatar text={initials} size={56} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 20, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{currentUser?.name}</Text>
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 2 }}>{currentUser?.email}</Text>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, marginTop: 6 }}>{roleText(currentUser?.role)}</Text>
            </View>
          </View>
        </HeroSurface>
      </View>

      <Section title="Your access">
        <Kv label="You can open" value={opens || "Home only"} />
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingBottom: 4 }}>
          Set by your Menu Rights on the web. Ask your admin to change them.
        </Text>
      </Section>

      <Section title="Account">
        {currentUser ? <ChangePassword userId={currentUser.id} /> : null}
      </Section>
    </Page>
  );
}

export function SettingsScreen() {
  const b = useBrand();
  const { mode, toggleMode, accentKey, setAccent } = useTheme();
  const { appVersion } = useAppVersion();
  const [checking, setChecking] = useState(false);

  const checkUpdate = async () => {
    if (Platform.OS !== "android") return toast.info("Updates are installed from the Android app.");
    setChecking(true);
    const r = await checkForUpdateNow();
    setChecking(false);
    if (r === "latest") toast.success("You have the latest version.");
    else if (r === "unavailable") toast.error("Couldn't check for updates. Check your connection.");
  };

  return (
    <Page gap={0}>
      <Section title="Appearance">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}>
          <Text style={{ fontSize: 15, fontFamily: fonts.body.medium, color: b.textPrimary }}>Dark mode</Text>
          <Switch value={mode === "dark"} onValueChange={toggleMode} trackColor={{ true: b.accent, false: b.surfaceGlass }} thumbColor="#fff" />
        </View>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textSecondary, paddingTop: 6, paddingBottom: 10 }}>Accent colour</Text>
        <View style={{ flexDirection: "row", gap: 12, paddingBottom: 6 }}>
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
            <Tap key={k} onPress={() => setAccent(k)} accessibilityRole="button" accessibilityLabel={ACCENTS[k].label} accessibilityState={{ selected: accentKey === k }}
              style={{ alignItems: "center", gap: 6 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENTS[k].hex, alignItems: "center", justifyContent: "center",
                borderWidth: accentKey === k ? 3 : 0, borderColor: b.textPrimary }}>
                {accentKey === k ? <Check size={18} color="#fff" /> : null}
              </View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: accentKey === k ? b.textPrimary : b.textSecondary }}>{ACCENTS[k].label}</Text>
            </Tap>
          ))}
        </View>
      </Section>

      <Section title="App">
        <Kv label="Installed" value={Application.nativeApplicationVersion ? `${Application.nativeApplicationVersion} (${Application.nativeBuildVersion})` : "—"} />
        <Kv label="Server" value={appVersion && appVersion !== "…" ? appVersion : "—"} />
        <LinkRow title={checking ? "Checking…" : "Check for update"} icon={RefreshCw} onPress={checking ? undefined : checkUpdate} />
      </Section>
    </Page>
  );
}
