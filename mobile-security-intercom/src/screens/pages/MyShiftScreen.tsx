// Menu → My shift (guard): today's gate and shift, and location sharing (start / stop, phone settings).
import { View, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { Body, InfoGrid, Notice, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { fetchSecurityDashboard } from "@/api/securityDashboardApi";
import { TrackingCard } from "@/tracking/TrackingCard";

const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");

export default function MyShiftScreen() {
  const { data, error } = useQuery({ queryKey: ["security-dashboard", "guard", null], queryFn: () => fetchSecurityDashboard("guard"), refetchInterval: 60000 });
  const a = data?.assignment;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security · Guard" title="My shift" />
        {error && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice>{(error as Error).message}</Notice>
          </View>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
          {a ? (
            <InfoGrid
              items={[
                { label: "Gate", value: a.gateName },
                { label: "Project", value: a.projectName || "—" },
                { label: "Shift", value: `${clock(a.shiftStart)} – ${clock(a.shiftEnd)}` },
                { label: "Now", value: a.onDuty ? "On duty" : "Off duty" },
              ]}
            />
          ) : (
            <Body color={S.graphite}>{data === undefined ? "Reading…" : "You have no gate assignment today. Ask your supervisor."}</Body>
          )}
        </View>
        <TrackingCard onDuty={!!a?.onDuty} shiftEnd={a?.shiftEnd ?? null} />
      </SheetFrame>
    </ScrollView>
  );
}
