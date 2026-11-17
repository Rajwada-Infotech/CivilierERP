// Salary and payslips: only payroll months HR has Locked are shown. Tap a month for the full payslip.
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Wallet } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Body, Label, Notice, Panel, Skel, StatGrid } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { MONTHS, rupee } from "@/utils/format";
import type { MainParamList } from "@/navigation/MainStack";

export default function PayScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainParamList>>();
  const sal = useQuery({ queryKey: ["salary"], queryFn: api.salary });
  const slips = useQuery({ queryKey: ["payslips"], queryFn: api.payslips });
  const s = sal.data;

  return (
    <Screen refreshing={sal.isRefetching || slips.isRefetching} onRefresh={() => { sal.refetch(); slips.refetch(); }}>
      <Panel title="Salary" icon={<Wallet size={14} color={S.ink} />}>
        {sal.isError && <Notice>{(sal.error as Error).message}</Notice>}
        <StatGrid cols={2} size={16} loading={sal.isLoading} items={[
          { label: `CTC${s?.CTCFrequency ? ` (${s.CTCFrequency})` : ""}`, value: s?.CTCAmount != null ? rupee(s.CTCAmount) : "—", wide: true },
          { label: "Last gross", value: s?.Latest ? rupee(s.Latest.GrossSalary) : "—" },
          { label: "Last net pay", value: s?.Latest ? rupee(s.Latest.NetSalary) : "—" },
        ]} />
        {s?.SalaryStructureName && <Body size={12} color={S.graphite}>Structure: {s.SalaryStructureName}</Body>}
      </Panel>

      <Panel title="Payslips">
        {slips.isLoading ? <Skel h={60} /> : slips.isError ? <Notice>{(slips.error as Error).message}</Notice> : !slips.data?.length ? (
          <Body color={S.graphite}>No payslip yet. Payslips appear once HR locks the month's payroll.</Body>
        ) : (
          slips.data.map((p) => (
            <Pressable key={p.PayrollRunId} onPress={() => nav.navigate("Payslip", { runId: p.PayrollRunId })}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Body weight="semibold">{MONTHS[p.PeriodMonth - 1]} {p.PeriodYear}</Body>
                <Body size={11.5} color={S.graphite}>Gross {rupee(p.GrossSalary)} · Deductions {rupee(p.TotalEmployeeDeduction)}</Body>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Label>Net</Label>
                <Body weight="semibold">{rupee(p.NetSalary)}</Body>
              </View>
              <ChevronRight size={16} color={S.graphite} />
            </Pressable>
          ))
        )}
      </Panel>
    </Screen>
  );
}
