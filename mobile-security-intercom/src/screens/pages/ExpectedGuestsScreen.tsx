// Menu → Expected guests (guard). The residents' guest passes valid now at this project. A guest shows their 6-digit
// code, or the guard finds them in the list; "Let in" records the visit as approved on the resident's pass (no asking),
// and the resident is told their guest arrived.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Field, Input, Key, Notice, SheetFrame, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { expectedGuests, type ExpectedGuest } from "@/api/securityMoreApi";
import { createVisitor, VisitorRefused } from "@/api/visitorsApi";
import { newRequestId } from "@/visitors/offlineQueue";

const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);

export default function ExpectedGuestsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { data = [], isLoading, refetch } = useQuery({ queryKey: ["security-expected-guests"], queryFn: expectedGuests, refetchInterval: 30000 });

  const letIn = async (by: { passId?: number; passCode?: string }, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const v = await createVisitor({ clientRequestId: newRequestId(), block: "", flatNo: "", reason: "", ...by });
      navigation.replace("VisitorStatus", { id: v.id });
    } catch (e) {
      setError(e instanceof VisitorRefused ? e.message : "Couldn't reach the server. Try again when the network is back.");
    } finally {
      setBusy(null);
    }
  };

  const confirm = (g: ExpectedGuest) =>
    Alert.alert("Let the guest in?", `${g.guestName} for flat ${flatOf(g.block, g.flat)}, on the resident's pass.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Let in", onPress: () => void letIn({ passId: g.id }, `p${g.id}`) },
    ]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security · Guard" title="Expected guests" subtitle="Guests the residents approved in advance" />
        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
          <Field label="Pass code">
            <Input value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} placeholder="6 digits" keyboardType="number-pad" maxLength={6} />
          </Field>
          {error && <Notice>{error}</Notice>}
          <Key tone="ink" label={busy === "code" ? "Checking…" : "Let in with code"} onPress={() => void letIn({ passCode: code }, "code")} disabled={code.length !== 6 || !!busy} />
        </View>
        <Detail tag="A" title="Valid now" note={`${data.length}`}>
          {isLoading ? (
            <Skel h={40} />
          ) : data.length === 0 ? (
            <Body color={S.graphite}>No guest pass is valid right now.</Body>
          ) : (
            data.map((g, i) => (
              <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: i === data.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>{g.guestName}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>
                    {[`Flat ${flatOf(g.block, g.flat)}`, g.vehicleNo, g.note, `until ${new Date(g.validTo).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`, g.usesLeft > 1 ? `${g.usesLeft} entries left` : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Key label={busy === `p${g.id}` ? "…" : "Let in"} onPress={() => confirm(g)} disabled={!!busy} />
              </View>
            ))
          )}
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
