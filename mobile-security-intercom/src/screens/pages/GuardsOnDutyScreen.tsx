// Menu → Guards on duty (security admin): who is on shift now, at which gate, in or out of the zone, last seen and
// battery. Out of zone and silent phones first.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Notice, SheetFrame, SheetMark, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { getLive, type LiveData } from "@/api/securityMoreApi";

type G = LiveData["guards"][number];
const STALE = 5 * 60 * 1000;
const state = (g: G) => (!g.last || Date.now() - new Date(g.last.at).getTime() > STALE ? "silent" : g.last.inZone === false ? "out" : g.last.inZone ? "in" : "unknown");
const ago = (iso?: string) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const ORDER = { out: 0, silent: 1, unknown: 2, in: 3 } as const;

export default function GuardsOnDutyScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["security-live"], queryFn: getLive, refetchInterval: 15000 });
  const guards = [...(data?.guards ?? [])].sort((a, b) => ORDER[state(a)] - ORDER[state(b)] || a.name.localeCompare(b.name));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security · Admin" title="Guards on duty" subtitle={data ? `${guards.length} on shift now` : undefined} />
        {error && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice>{(error as Error).message}</Notice>
          </View>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: S.ink, paddingHorizontal: 16 }}>
          {isLoading ? (
            <View style={{ paddingVertical: 14 }}><Skel h={44} /></View>
          ) : guards.length === 0 ? (
            <Body color={S.ink2} style={{ paddingVertical: 18 }}>No guard is on shift right now.</Body>
          ) : (
            guards.map((g, i) => {
              const st = state(g);
              return (
                <View key={g.guardUserId} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: i === guards.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>{g.name}</Text>
                    <Text style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>
                      {[g.gateName, `seen ${ago(g.last?.at)}`, g.last?.battery != null ? `battery ${g.last.battery}%` : null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <SheetMark text={st === "out" ? "Outside" : st === "silent" ? "No signal" : st === "in" ? "In zone" : "Unjudged"} tone={st === "out" || st === "silent" ? "stopped" : st === "in" ? "done" : "draft"} />
                </View>
              );
            })
          )}
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
