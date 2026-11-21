// The CRM tab: the CRM Dashboard, then every CRM list (crmRegisters.ts) in the web menu's groups, as plain rows —
// each only for staff with a right on its page, with a count where something waits (the dashboard's own alerts).
// Bookings has its own tab, and a paired list (Call History) opens from its parent's switch, so neither is repeated.
import { Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LayoutDashboard } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { TAB_LISTS } from "@/navigation/navigationRef";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { CRM_GROUPS, CRM_REGISTERS, isListedRegister } from "./crmRegisters";
import { useCrmDashboard } from "./CrmDashboardScreen";
import { Empty, Heading, MenuGroup, Page, type MenuItem } from "./ui";

// Which dashboard alert counts on which list (crmDashboard.js GET / alerts).
const COUNT_OF: Record<string, string> = {
  "welcome-calls": "welcomeCallPending",
  demands: "overduePayments",
  "service-tickets": "urgentTickets",
  possession: "disputedNotices",
};

export default function CrmHubScreen() {
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();
  const seesDashboard = canAccessPage("crm-dashboard");
  const dashQ = useCrmDashboard(null, seesDashboard);
  const alerts = dashQ.data?.alerts ?? {};
  const lists = CRM_REGISTERS.filter((r) => isListedRegister(r) && !TAB_LISTS.includes(r.key) && r.pages.some((p) => canAccessPage(p)));

  return (
    <Page tab gap={12} onRefresh={async () => { if (seesDashboard) await dashQ.refetch(); }}>
      {seesDashboard ? (
        <MenuGroup items={[{ key: "dash", label: "CRM Dashboard", sub: "Collection, what needs attention, the week ahead", icon: LayoutDashboard, onPress: () => nav.navigate("CrmDashboard") }]} />
      ) : null}
      {CRM_GROUPS.map((g) => {
        const items: MenuItem[] = lists.filter((r) => r.group === g).map((r) => ({
          key: r.key, label: r.label, icon: r.icon, badge: COUNT_OF[r.key] ? Number(alerts[COUNT_OF[r.key]]) || 0 : 0,
          onPress: () => nav.navigate("CrmRegister", { register: r.key }),
        }));
        if (!items.length) return null;
        return (
          <View key={g} style={{ gap: 10 }}>
            <Heading title={g} />
            <MenuGroup items={items} />
          </View>
        );
      })}
      {!seesDashboard && !lists.length ? <Empty text="You don't have a right on any CRM page. Ask your admin for Menu Rights." /> : null}
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, textAlign: "center", marginTop: 6 }}>
        Agreements, deeds, invoices and refunds are worked on the web.
      </Text>
    </Page>
  );
}
