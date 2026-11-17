// Profile: the employee's own record, theme, holidays, login history, sign out.
import { Alert, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CalendarDays, ChevronRight, History, LogOut, Palette } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { useAuth } from "@/auth/AuthContext";
import { Screen } from "@/components/Screen";
import { Body, InfoGrid, Key, Label, Notice, Panel, Skel, SheetFrame, TitleText } from "@/components/sheet/Sheet";
import { THEMES, sheet as S } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeContext";
import { fmtDate } from "@/utils/format";
import type { MainParamList } from "@/navigation/MainStack";

function Link({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
      {icon}<Body weight="medium" style={{ flex: 1 }}>{label}</Body><ChevronRight size={16} color={S.graphite} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainParamList>>();
  const { currentUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 10 * 60_000 });
  const e = me.data;

  return (
    <Screen refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <SheetFrame>
        <View style={{ padding: 16, gap: 4 }}>
          <Label>{e?.EmployeeCode ?? "Employee"}</Label>
          <TitleText size={22}>{e?.EmployeeName ?? currentUser?.name ?? "…"}</TitleText>
          <Body size={12.5} color={S.graphite}>{currentUser?.email}</Body>
        </View>
      </SheetFrame>

      <Panel title="My details">
        {me.isLoading ? <Skel h={100} /> : me.isError ? <Notice>{(me.error as Error).message}</Notice> : e && (
          <InfoGrid items={[
            { label: "Company", value: e.CompanyName ?? "—", wide: true },
            { label: "Designation", value: e.Designation ?? "—" },
            { label: "Department", value: e.Department ?? "—" },
            { label: "Branch", value: e.BranchLocation ?? "—" },
            { label: "Type", value: e.EmploymentType ?? "—" },
            { label: "Joined", value: fmtDate(e.JoiningDate) },
            { label: "Mobile", value: e.Mobile ?? "—" },
          ]} />
        )}
        <Body size={11} color={S.graphite}>To correct these details, contact HR.</Body>
      </Panel>

      <Panel title="More">
        <Link icon={<CalendarDays size={16} color={S.ink} />} label="Holiday calendar" onPress={() => nav.navigate("Holidays")} />
        <Link icon={<History size={16} color={S.ink} />} label="My login history" onPress={() => nav.navigate("LoginHistory")} />
      </Panel>

      <Panel title="Theme" icon={<Palette size={14} color={S.ink} />}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {THEMES.map((t) => (
            <Pressable key={t.name} onPress={() => setTheme(t.name)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme === t.name ? S.ink : S.rule, paddingHorizontal: 10, paddingVertical: 8 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.swatch, borderWidth: 1, borderColor: S.rule }} />
              <Body size={12}>{t.label}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Key tone="red" label="Sign out" icon={<LogOut size={16} color="#ffffff" />} onPress={() =>
        Alert.alert("Sign out?", "", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void logout() }])} />
    </Screen>
  );
}
