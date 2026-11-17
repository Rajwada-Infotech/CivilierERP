import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Body, IconKey, Notice, Panel, Skel, TitleText } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate, todayIst } from "@/utils/format";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HolidaysScreen() {
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const q = useQuery({ queryKey: ["holidays", year], queryFn: () => api.holidays(year) });
  const today = todayIst();
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <IconKey onPress={() => setYear(year - 1)}><ChevronLeft size={16} color={S.ink} /></IconKey>
        <TitleText size={20}>Holidays {year}</TitleText>
        <IconKey onPress={() => setYear(year + 1)}><ChevronRight size={16} color={S.ink} /></IconKey>
      </View>
      <Panel title={`${q.data?.length ?? 0} holidays`}>
        {q.isLoading ? <Skel h={80} /> : q.isError ? <Notice>{(q.error as Error).message}</Notice> : !q.data?.length ? (
          <Body color={S.graphite}>No holidays listed for {year}.</Body>
        ) : q.data.map((h) => {
          const d = h.HolidayDate.slice(0, 10);
          const past = d < today;
          return (
            <View key={h.HolidayId} style={{ flexDirection: "row", justifyContent: "space-between", opacity: past ? 0.5 : 1, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 8 }}>
              <Body weight="semibold" style={{ flex: 1 }}>{h.HolidayName}</Body>
              <Body color={S.ink2}>{DAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}, {fmtDate(d)}</Body>
            </View>
          );
        })}
      </Panel>
    </Screen>
  );
}
