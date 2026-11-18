// Updates & Approvals — premium redesign. Same logic as before.
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, History } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { portal } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { useNeedsYou } from "@/customer/todo";
import { ActionBanner, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Tap } from "@/customer/ui";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";

const FILTERS: { key: string; label: string }[] = [
  { key: "",           label: "All" },
  { key: "agreement",  label: "Agreement" },
  { key: "legal",      label: "Legal & Registry" },
  { key: "payment",    label: "Payments" },
  { key: "document",   label: "Documents" },
  { key: "ticket",     label: "Support" },
];

const when = (d: string) =>
  new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function CustomerActivityScreen() {
  const brand = useBrand();
  const nav     = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { appId, timeline } = useCustomer();
  const enabled = appId != null;
  const feed      = useQuery({ queryKey: ["portal-activity", appId],              queryFn: () => portal.activity(appId as number), enabled });
  const needs     = useNeedsYou(appId);
  const [filter, setFilter] = useState("");

  const list = useMemo(
    () => (filter ? (feed.data || []).filter((e) => e.type === filter) : feed.data || []),
    [feed.data, filter],
  );
  const todo = needs.data || [];

  return (
    <Page onRefresh={() => Promise.all([feed.refetch(), needs.refetch(), timeline.refetch()])}>
      <Muted>A running log of everything that's happened — agreement approvals, payments, documents, and support.</Muted>

      {/* Action items */}
      {todo.length > 0 ? (
        <Panel title="Needs Your Action" icon={AlertTriangle}>
          {todo.map((a) => (
            <ActionBanner
              key={`${a.kind}-${a.label}`}
              title={a.label}
              sub={a.sub}
              tone={a.urgent ? "red" : "gold"}
              cta="Open ›"
              onPress={() => nav.navigate(a.route as never)}
            />
          ))}
        </Panel>
      ) : null}

      {/* Filter chips */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Tap
              key={f.key || "all"}
              onPress={() => setFilter(f.key)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 100,
                borderWidth: 1.5,
                backgroundColor: on ? brand.goldSoft : "transparent",
                borderColor: on ? brand.gold : brand.border,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: on ? brand.gold : brand.textSecondary }}>
                {f.label}
              </Text>
            </Tap>
          );
        })}
      </View>

      {/* History feed */}
      <Panel title="History" icon={History}>
        {feed.isLoading ? <Loading /> : feed.error ? <ErrorText error={feed.error} /> : !list.length ? (
          <View style={{ gap: 6, paddingVertical: 8 }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Nothing here yet</Text>
            <Muted>Updates will show up here the moment something happens on your application.</Muted>
          </View>
        ) : list.map((e, i) => (
          <View key={`${e.at}-${i}`}>
            {i ? <Divider /> : null}
            <ListRow title={e.title} sub={[e.detail, when(e.at)].filter(Boolean).join(" · ")} />
          </View>
        ))}
      </Panel>
    </Page>
  );
}
