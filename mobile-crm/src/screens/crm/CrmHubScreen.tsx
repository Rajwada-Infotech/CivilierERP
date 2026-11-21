// The CRM tab — the CRM dashboard and every CRM list on one page (there is no separate dashboard). For staff with the
// dashboard right (crm-dashboard): the project picker, this month and next, the collection, what needs attention,
// the pipeline, collection per project (all projects) and the seven-day lookahead — the web's CRM Dashboard, its
// parts in CrmDashboardScreen.tsx. Then the lists (crmRegisters.ts) in the web menu's groups, each only for staff with
// a right on its page. Nothing is said twice: a list "Needs attention" already counts shows what it holds instead of
// that number. Bookings has its own tab, and Call History opens from Welcome Calls' switch.
import { useState } from "react";
import { Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { TAB_LISTS } from "@/navigation/navigationRef";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { CRM_GROUPS, CRM_REGISTERS, MENU_LISTS, isListedRegister, registerByKey } from "./crmRegisters";
import {
  AttentionList, CollectionPerProject, MoneyFigures, Pipeline, ProjectChips, ThisMonthCard, WeekAhead, attentionRegisters, useCrmDashboard,
} from "./CrmDashboardScreen";
import { Empty, ErrorText, Heading, Loading, MenuGroup, Page, type MenuItem } from "./ui";

const n0 = (v: unknown) => Number(v) || 0;
/** "12 pending · 2 draft" from a server status list ([{ Status, Count }]), the statuses given, in that order. */
const statusLine = (rows: { Status: string; Count: number }[] | undefined, statuses: string[]) =>
  statuses.map((st) => ({ st, c: n0((rows ?? []).find((r) => r.Status === st)?.Count) })).filter((x) => x.c > 0)
    .map((x) => `${x.c} ${x.st.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`).join(" · ");


export default function CrmHubScreen() {
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();
  const seesDashboard = canAccessPage("crm-dashboard");
  const [projectId, setProjectId] = useState<number | null>(null);
  // The project list comes with the all-projects figures, so the picker keeps every project when one is chosen.
  const allQ = useCrmDashboard(null, seesDashboard);
  const q = useCrmDashboard(projectId, seesDashboard);
  const d = q.data;
  // Every page is offered once in the app: Bookings has its tab, the Menu has Customer 360, Service Tickets and
  // Construction Updates, so the CRM tab lists the rest.
  const lists = CRM_REGISTERS.filter((r) => isListedRegister(r) && !TAB_LISTS.includes(r.key) && !MENU_LISTS.includes(r.key) && r.pages.some((p) => canAccessPage(p)));
  const inAttention = d ? attentionRegisters(d) : [];

  // A live line where the page doesn't already give that figure: applications by status, tickets open, handovers by
  // status. Lists "Needs attention" counts keep their "about" line.
  const lineOf = (key: string): string => {
    const about = registerByKey(key)?.about ?? "";
    if (!d || inAttention.includes(key)) return about;
    if (key === "applications") return statusLine(d.applications, ["Pending", "Draft"]) || about;
    if (key === "possession") return statusLine(d.handovers, ["Scheduled", "InProgress", "Completed"]) || about;
    return about;
  };

  return (
    <Page tab gap={14} onRefresh={async () => { if (seesDashboard) await Promise.all([allQ.refetch(), q.refetch()]); }}>
      {seesDashboard ? (
        <>
          <ProjectChips projects={allQ.data?.projects ?? []} value={projectId} onChange={setProjectId} />
          {q.error ? <ErrorText error={q.error} /> : !d ? <Loading /> : (
            <>
              <ThisMonthCard d={d} />
              <View>
                <MoneyFigures d={d} />
                <AttentionList d={d} links={false} />
                <Pipeline d={d} />
                {projectId == null ? <CollectionPerProject d={d} /> : null}
                <WeekAhead d={d} />
              </View>
            </>
          )}
        </>
      ) : null}

      {CRM_GROUPS.map((g) => {
        const items: MenuItem[] = lists.filter((r) => r.group === g).map((r) => ({
          key: r.key, label: r.label, sub: lineOf(r.key), icon: r.icon,
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
