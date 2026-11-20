// Settings screen — theme switcher (dark/light + accent colour), account
// management (change password, sign out), support and about sections.
// Nav-drawer style: large touch targets, section headers, icons.
import { useState } from "react";
import Constants from "expo-constants";
import {
  View, Text, Switch, ScrollView,
  TextInput, Platform,
} from "react-native";
import {
  Sun, Moon, LogOut, KeyRound, LifeBuoy,
  Info, ChevronRight,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { useAuth } from "@/auth/AuthContext";
import { portal } from "@/api/customerPortalApi";
import { useTheme, useBrand, ACCENTS, type AccentKey } from "@/theme/ThemeContext";
import { Page, Panel, Tap, useTopInset } from "@/customer/ui";
import { openCustomerScreen } from "@/navigation/navigationRef";

// ── Inline password form ──────────────────────────────────────────────────
function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const b = useBrand();
  const { passwordChanged } = useAuth();
  const [pw, setPw]       = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy]   = useState(false);

  const inputStyle = {
    borderWidth: 1,
    borderColor: b.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: b.textPrimary,
    fontFamily: fonts.body.regular,
    fontSize: 13,
    backgroundColor: b.surface,
    marginBottom: 10,
  } as const;

  const save = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
      return toast.error("Password must contain both letters and numbers");
    if (pw !== again) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await portal.changePassword(pw);
      toast.success("Password updated — please sign in again");
      await passwordChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the password");
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.5, marginBottom: 2 }}>
        NEW PASSWORD
      </Text>
      <TextInput value={pw} onChangeText={setPw} secureTextEntry style={inputStyle}
        autoCapitalize="none" textContentType="newPassword" placeholder="Min 8 chars, letters + numbers"
        placeholderTextColor={b.textFaint} />
      <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.5, marginBottom: 2 }}>
        CONFIRM PASSWORD
      </Text>
      <TextInput value={again} onChangeText={setAgain} secureTextEntry style={inputStyle}
        autoCapitalize="none" textContentType="newPassword" placeholder="Repeat password"
        placeholderTextColor={b.textFaint} />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        <Tap onPress={onDone}
          style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: b.border, alignItems: "center" }}>
          <Text style={{ color: b.textSecondary, fontFamily: fonts.heading.medium, fontSize: 14 }}>Cancel</Text>
        </Tap>
        <Tap onPress={() => { if (!busy) void save(); }}
          style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: b.accent, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
          <Text style={{ color: b.isDark ? "#1a1a00" : "#fff", fontFamily: fonts.heading.semibold, fontSize: 14 }}>
            {busy ? "Saving…" : "Set Password"}
          </Text>
        </Tap>
      </View>
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  const b = useBrand();
  return (
    <Text style={{
      fontSize: 11, fontFamily: fonts.heading.semibold, letterSpacing: 1.2,
      color: b.accent, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4,
    }}>
      {title}
    </Text>
  );
}

// ── Generic tappable row ──────────────────────────────────────────────────
function SettingRow({
  icon: Icon, label, sublabel, onPress, destructive = false, right,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string; sublabel?: string;
  onPress?: () => void; destructive?: boolean;
  right?: React.ReactNode;
}) {
  const b = useBrand();
  const color = destructive ? b.danger : b.textPrimary;
  return (
    <Tap onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingVertical: 15, paddingHorizontal: 16,
        backgroundColor: pressed ? b.surfaceGlass : "transparent",
        borderRadius: 12,
      })}>
      <View style={{
        width: 38, height: 38, borderRadius: 12,
        backgroundColor: destructive ? b.dangerSoft : b.accentSoft,
        alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={18} color={destructive ? b.danger : b.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.heading.medium, color }}>{label}</Text>
        {sublabel ? (
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 1 }}>{sublabel}</Text>
        ) : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={16} color={b.textFaint} /> : null)}
    </Tap>
  );
}

// ── Accent colour dots ────────────────────────────────────────────────────
function AccentPicker() {
  const { accentKey, setAccent } = useTheme();
  const b = useBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={{ fontSize: 14, fontFamily: fonts.heading.medium, color: b.textPrimary, flex: 1 }}>Accent Colour</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {(Object.values(ACCENTS) as typeof ACCENTS[AccentKey][]).map((a) => (
          <Tap key={a.key} onPress={() => setAccent(a.key as AccentKey)}
            accessibilityLabel={a.label}
            style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: a.hex,
              borderWidth: accentKey === a.key ? 2.5 : 1.5,
              borderColor: accentKey === a.key ? "#fff" : "transparent",
              shadowColor: a.hex, shadowOpacity: accentKey === a.key ? 0.7 : 0,
              shadowRadius: 6, elevation: accentKey === a.key ? 6 : 0,
            }} />
        ))}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────
export default function CustomerSettingsScreen() {
  const b = useBrand();
  const { mode, toggleMode } = useTheme();
  const { logout } = useAuth();
  const navigation = useNavigation();
  const [changingPw, setChangingPw] = useState(false);

  const divider = <View style={{ height: 1, backgroundColor: b.border, marginHorizontal: 4 }} />;

  const top = useTopInset();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: b.surface }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: top + 8, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Appearance ── */}
      <SectionHeader title="APPEARANCE" />
      <View style={{ backgroundColor: b.surfaceCard, borderRadius: 16, borderWidth: 1, borderColor: b.border, overflow: "hidden", marginBottom: 16 }}>
        {/* Dark / Light toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 16 }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
            {mode === "dark"
              ? <Moon size={18} color={b.accent} />
              : <Sun  size={18} color={b.accent} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontFamily: fonts.heading.medium, color: b.textPrimary }}>
              {mode === "dark" ? "Dark Mode" : "Light Mode"}
            </Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 1 }}>
              Tap to switch appearance
            </Text>
          </View>
          <Switch
            value={mode === "dark"}
            onValueChange={toggleMode}
            trackColor={{ false: b.border, true: b.accentBorder }}
            thumbColor={mode === "dark" ? b.accent : b.textFaint}
            ios_backgroundColor={b.border}
          />
        </View>
        {divider}
        {/* Accent colour */}
        <AccentPicker />
      </View>

      {/* ── Account ── */}
      <SectionHeader title="ACCOUNT" />
      <View style={{ backgroundColor: b.surfaceCard, borderRadius: 16, borderWidth: 1, borderColor: b.border, overflow: "hidden", marginBottom: 16 }}>
        <SettingRow
          icon={KeyRound} label="Change Password" sublabel="Update your login password"
          onPress={() => setChangingPw((v) => !v)}
        />
        {changingPw ? (
          <>
            {divider}
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <ChangePasswordForm onDone={() => setChangingPw(false)} />
            </View>
          </>
        ) : null}
        {divider}
        <SettingRow
          icon={LogOut} label="Sign Out" sublabel="Log out of Civilier Home"
          destructive onPress={() => void logout()}
        />
      </View>

      {/* ── Support ── */}
      <SectionHeader title="SUPPORT" />
      <View style={{ backgroundColor: b.surfaceCard, borderRadius: 16, borderWidth: 1, borderColor: b.border, overflow: "hidden", marginBottom: 16 }}>
        <SettingRow
          icon={LifeBuoy} label="Ask for help" sublabel="Report a problem or ask a question"
          onPress={() => openCustomerScreen("CustomerRequests", undefined, navigation.navigate as never)}
        />
        {/* Call / Email / Privacy Policy return once the company's real contact details and policy page are given:
            none is on file anywhere in the project, and a made-up number or address must never reach a customer. */}
      </View>

      {/* ── About ── */}
      <SectionHeader title="ABOUT" />
      <View style={{ backgroundColor: b.surfaceCard, borderRadius: 16, borderWidth: 1, borderColor: b.border, overflow: "hidden", marginBottom: 16 }}>
        <SettingRow
          icon={Info} label="App Version"
          right={<Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textFaint }}>{Constants.expoConfig?.version ?? ""}</Text>}
        />
      </View>
    </ScrollView>
  );
}
