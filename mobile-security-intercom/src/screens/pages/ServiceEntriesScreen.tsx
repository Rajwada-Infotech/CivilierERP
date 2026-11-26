// Guard → Menu → Service entries: vehicles and workers in for maintenance or other official work at this gate's
// project — who is still inside (log them out as they leave) and today's log. No resident is involved.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Plus, Truck, HardHat } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, LinkLabel, Notice, SheetFrame, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { logServiceOut, PURPOSE_LABEL, serviceEntries, type ServiceEntry } from "@/api/serviceEntriesApi";

const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const isToday = (s: string) => new Date(s).toDateString() === new Date().toDateString();

export default function ServiceEntriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["security-service-entries"], queryFn: serviceEntries, refetchInterval: 60000 });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const inside = data.filter((e) => !e.outAt);
  const left = data.filter((e) => e.outAt);

  const out = (e: ServiceEntry) =>
    Alert.alert("Log out", `${e.kind === "VEHICLE" ? e.vehicleNo : e.personName} is leaving?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        onPress: async () => {
          setBusy(e.id);
          try {
            await logServiceOut(e.id);
            await refetch();
          } catch (err) {
            Alert.alert("Log out", (err as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const row = (e: ServiceEntry, i: number, list: ServiceEntry[]) => {
    const Icon = e.kind === "VEHICLE" ? Truck : HardHat;
    return (
      <View key={e.id} style={{ paddingVertical: 12, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon size={16} color={e.outAt ? S.graphite : S.ink} />
          <Text style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>
            {e.kind === "VEHICLE" ? `${e.vehicleNo} · ${e.personName}` : e.personName}
            {e.peopleCount > 1 ? ` +${e.peopleCount - 1}` : ""}
          </Text>
          <Label color={S.graphite}>{PURPOSE_LABEL[e.purpose] ?? e.purpose}</Label>
        </View>
        <Body size={12} color={S.ink2}>{[e.company, e.workArea, e.phone].filter(Boolean).join(" · ") || "—"}</Body>
        {e.note ? <Body size={12} color={S.graphite}>{e.note}</Body> : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Body size={11.5} color={S.graphite}>
            In {isToday(e.inAt) ? time(e.inAt) : `${day(e.inAt)} ${time(e.inAt)}`}
            {e.outAt ? ` · out ${time(e.outAt)}` : ""} · {e.gateName}
          </Body>
          {!e.outAt && <LinkLabel onPress={() => out(e)} color={S.blue}>{busy === e.id ? "Logging out…" : "Log out"}</LinkLabel>}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title="Service entries" subtitle="Maintenance, repairs, deliveries and official work" />
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
          <Key tone="ink" label="Log in a vehicle or worker" icon={<Plus size={15} color={S.paper} />} onPress={() => navigation.navigate("ServiceEntry")} />
        </View>
        {error && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Notice>{(error as Error).message}</Notice>
          </View>
        )}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: S.ink }}>
          <Label>Inside now · {inside.length}</Label>
          {isLoading ? <Skel h={48} /> : inside.length ? inside.map(row) : <Body size={12.5} color={S.ink2} style={{ paddingVertical: 12 }}>No one from a service visit is inside.</Body>}
        </View>
        {left.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Label>Left today · {left.length}</Label>
            {left.map(row)}
          </View>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
