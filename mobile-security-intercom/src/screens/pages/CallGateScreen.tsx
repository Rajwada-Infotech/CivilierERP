// Menu → Call the gate (resident): an in-app voice call to the guard on duty now at a gate of your project.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Notice, SheetFrame, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { callGate, callsAvailable, myGates } from "@/api/securityMoreApi";
import { nativeCallsAvailable } from "@/screens/calls/callSupport";

export default function CallGateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: gates = [], isLoading, refetch } = useQuery({ queryKey: ["security-my-gates"], queryFn: myGates, refetchInterval: 30000 });
  const { data: avail } = useQuery({ queryKey: ["security-calls-available", "customer"], queryFn: () => callsAvailable("customer") });

  const call = async (gateId: number) => {
    setBusy(gateId);
    setError(null);
    try {
      const c = await callGate(gateId);
      navigation.navigate("Call", { callId: c.callId, call: c });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title="Call the gate" subtitle="Talk to the guard on duty" />
        {!nativeCallsAvailable() && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice tone="ink">In-app calls need the installed Civilier Security app — they can't run inside Expo Go.</Notice>
          </View>
        )}
        {avail && !avail.inApp && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice tone="ink">In-app calling isn't switched on yet. Please call the security office by phone.</Notice>
          </View>
        )}
        {error && (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Notice>{error}</Notice>
          </View>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: S.ink, paddingHorizontal: 16 }}>
          {isLoading ? (
            <View style={{ paddingVertical: 14 }}><Skel h={44} /></View>
          ) : gates.length === 0 ? (
            <Body color={S.ink2} style={{ paddingVertical: 18 }}>No gate is set up for your project yet.</Body>
          ) : (
            gates.map((g, i) => (
              <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: i === gates.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>{g.name}</Text>
                  <Body size={12} color={g.guardOnDuty ? S.graphite : S.red}>{g.projectName} · {g.guardOnDuty ? "guard on duty" : "no guard on duty now"}</Body>
                </View>
                <Key tone="ink" label={busy === g.id ? "Calling…" : "Call"} icon={<Phone size={14} color={S.paper} />} onPress={() => void call(g.id)} disabled={!g.guardOnDuty || !!busy || avail?.inApp === false || !nativeCallsAvailable()} />
              </View>
            ))
          )}
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
