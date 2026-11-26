// Menu → Visitors. Guard: today's requests at the gate (waiting first). Resident: visitors waiting for them, then the
// flat's history. Tap one to open it (the guard sees its answer; the resident approves / denies or sees who did).
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Notice, Press, SheetFrame, SheetMark, Skel, TitleBlock, type MarkTone } from "@/components/sheet/Sheet";
import { useSecurityView } from "@/navigation/securityRole";
import { fetchSecurityDashboard, type VisitorRow, type VisitorStatus } from "@/api/securityDashboardApi";

const STATUS: Record<VisitorStatus, { text: string; tone: MarkTone }> = {
  PENDING: { text: "Waiting", tone: "waiting" },
  APPROVED: { text: "Approved", tone: "done" },
  DENIED: { text: "Denied", tone: "stopped" },
  NO_RESPONSE: { text: "No response", tone: "draft" },
};
const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function VisitorRows({ rows, onOpen, showFlat = true }: { rows: VisitorRow[]; onOpen: (v: VisitorRow) => void; showFlat?: boolean }) {
  return (
    <>
      {rows.map((v, i) => (
        <Press
          key={v.id}
          onPress={() => onOpen(v)}
          style={(p) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13.5, color: S.ink }}>
              {v.visitorName || "Visitor"} <Text style={{ fontFamily: fonts.body.regular, color: S.ink2 }}>· {v.reason}</Text>
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>
              {[showFlat ? `Flat ${flatOf(v.block, v.flat)}` : null, v.gateName, v.vehicleNo, time(v.requestedAt)].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <SheetMark text={STATUS[v.status]?.text ?? v.status} tone={STATUS[v.status]?.tone ?? "draft"} />
        </Press>
      ))}
    </>
  );
}

export default function VisitorsListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { view } = useSecurityView();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["security-dashboard", view, null],
    queryFn: () => fetchSecurityDashboard(view!, null),
    enabled: view === "guard" || view === "customer",
    refetchInterval: 15000,
  });
  const open = (v: VisitorRow) => (view === "customer" ? navigation.navigate("VisitorDecision", { id: v.id }) : navigation.navigate("VisitorStatus", { id: v.id }));
  const waiting = data?.pending ?? [];
  const rest = (data?.recent ?? []).filter((r) => !waiting.some((w) => w.id === r.id));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title={view === "guard" ? "Visitors today" : "Visitors"} />
        {error && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice>{(error as Error).message}</Notice>
          </View>
        )}
        <Detail tag="A" title="Waiting for an answer" note={waiting.length ? `${waiting.length}` : "None"}>
          {isLoading ? <Skel h={40} /> : waiting.length ? <VisitorRows rows={waiting} onOpen={open} showFlat={view !== "customer"} /> : <Body color={S.graphite}>Nobody is waiting.</Body>}
        </Detail>
        <Detail tag="B" title={view === "guard" ? "Earlier today" : "History"}>
          {isLoading ? <Skel h={40} /> : rest.length ? <VisitorRows rows={rest} onOpen={open} showFlat={view !== "customer"} /> : <Body color={S.graphite}>No visitors yet.</Body>}
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
