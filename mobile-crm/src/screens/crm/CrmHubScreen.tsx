// The CRM menu: the Dashboard and every CRM list (crmRegisters.ts) in the web menu's groups, each shown only to staff
// with a right on its page.
import { ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { CRM_GROUPS, CRM_REGISTERS } from "./crmRegisters";
import { Empty, LinkRow, Section } from "./ui";

/** True when the person may open anything in the CRM — the menu and home show the CRM only then. */
export function useHasCrm() {
  const { canAccessPage } = useAuth();
  return canAccessPage("crm-dashboard") || CRM_REGISTERS.some((r) => r.pages.some((p) => canAccessPage(p)));
}

export default function CrmHubScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();
  const visible = CRM_REGISTERS.filter((r) => r.pages.some((p) => canAccessPage(p)));
  const dashboard = canAccessPage("crm-dashboard");

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
      {dashboard ? (
        <Section title="Overview">
          <LinkRow title="Dashboard" sub="Collection, what needs attention, the week ahead" onPress={() => nav.navigate("CrmDashboard")} />
        </Section>
      ) : null}
      {CRM_GROUPS.map((g) => {
        const regs = visible.filter((r) => r.group === g);
        if (!regs.length) return null;
        return (
          <Section key={g} title={g}>
            {regs.map((r, i) => (
              <View key={r.key} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <LinkRow title={r.label} onPress={() => nav.navigate("CrmRegister", { register: r.key })} />
              </View>
            ))}
          </Section>
        );
      })}
      {!dashboard && !visible.length ? <Empty text="You don't have a right on any CRM page. Ask your admin for Menu Rights." /> : null}
      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4 }}>
        To change a record, use CivilierERP on the web.
      </Text>
    </ScrollView>
  );
}
