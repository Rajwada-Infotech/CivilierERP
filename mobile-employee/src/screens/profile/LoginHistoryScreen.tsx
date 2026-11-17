import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Chip } from "@/components/Chip";
import { Body, Notice, Panel, Skel } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDateTime } from "@/utils/format";

export default function LoginHistoryScreen() {
  const q = useQuery({ queryKey: ["login-history"], queryFn: api.loginHistory });
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Panel title="Recent sign-ins">
        {q.isLoading ? <Skel h={80} /> : q.isError ? <Notice>{(q.error as Error).message}</Notice> : !q.data?.length ? (
          <Body color={S.graphite}>No sign-ins recorded yet.</Body>
        ) : q.data.map((r) => (
          <View key={r.LoginHistoryId} style={{ gap: 3, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body weight="semibold">{fmtDateTime(r.LoginAt)}</Body>
              <Chip text={r.Success ? "Success" : "Failed"} />
            </View>
            <Body size={11.5} color={S.graphite}>
              {[r.Portal ? `${r.Portal} login` : "App", r.IpAddress, r.FailureReason].filter(Boolean).join(" · ")}
            </Body>
          </View>
        ))}
      </Panel>
    </Screen>
  );
}
