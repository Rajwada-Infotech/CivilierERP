// Menu → Guest passes (resident): approve an expected guest in advance. The pass gets a 6-digit code to share with the
// guest; at the gate the guard enters it (or finds the guest in the day's list) and lets them in without asking you,
// and you're told when they arrive. A pass covers one flat, a time window and a number of entries; cancel it any time.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Field, Input, Key, Label, LinkLabel, Notice, Seg, SheetFrame, SheetMark, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { cancelPass, createPass, myPasses, type GuestPass } from "@/api/securityMoreApi";
import { fetchSecurityDashboard } from "@/api/securityDashboardApi";

const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const DURATIONS = [
  { value: "4h", label: "4 hours", ms: 4 * 3600000 },
  { value: "today", label: "Today", ms: 0 },
  { value: "2d", label: "2 days", ms: 2 * 86400000 },
  { value: "7d", label: "7 days", ms: 7 * 86400000 },
] as const;
type Duration = (typeof DURATIONS)[number]["value"];

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}
const shareText = (flat: string, code: string, validTo: string) =>
  `Your gate pass for flat ${flat}: code ${code}. Valid until ${when(validTo)}. Show this code to the guard.`;

function PassRow({ p, last, onCancel }: { p: GuestPass; last: boolean; onCancel: (p: GuestPass) => void }) {
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink, flex: 1 }}>{p.guestName}</Text>
        {p.active ? (
          <Text style={{ fontFamily: fonts.heading.bold, fontSize: 18, letterSpacing: 2, color: S.ink, fontVariant: ["tabular-nums"] }}>{p.code}</Text>
        ) : (
          <SheetMark text={p.cancelledAt ? "Cancelled" : p.uses >= p.maxUses ? "Used" : "Expired"} tone="draft" />
        )}
      </View>
      <Body size={12} color={S.graphite}>
        {[`Flat ${flatOf(p.block, p.flat)}`, `${when(p.validFrom)} – ${when(p.validTo)}`, `${p.uses}/${p.maxUses} used`, p.vehicleNo].filter(Boolean).join(" · ")}
      </Body>
      {p.active && (
        <View style={{ flexDirection: "row", gap: 16 }}>
          <LinkLabel onPress={() => void Share.share({ message: shareText(flatOf(p.block, p.flat), p.code, p.validTo) })} color={S.blue}>Share code</LinkLabel>
          <LinkLabel onPress={() => onCancel(p)} color={S.red}>Cancel</LinkLabel>
        </View>
      )}
    </View>
  );
}

export default function PassesScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: passes = [], isLoading, refetch } = useQuery({ queryKey: ["security-passes"], queryFn: myPasses });
  const { data: dash } = useQuery({ queryKey: ["security-dashboard", "customer", null], queryFn: () => fetchSecurityDashboard("customer") });
  const flats = dash?.flats ?? [];

  const [residentId, setResidentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState<Duration>("today");
  const [uses, setUses] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatId = residentId ?? flats[0]?.residentId ?? null;
  const chosen = flats.find((f) => f.residentId === flatId);

  const active = useMemo(() => passes.filter((p) => p.active), [passes]);
  const past = useMemo(() => passes.filter((p) => !p.active), [passes]);

  const submit = async () => {
    if (!flatId || !chosen) return setError("You have no flat registered for the Security app yet.");
    if (!name.trim()) return setError("Enter the guest's name.");
    setError(null);
    setBusy(true);
    const d = DURATIONS.find((x) => x.value === duration)!;
    const from = new Date();
    const to = d.value === "today" ? endOfToday() : new Date(from.getTime() + d.ms);
    try {
      const r = await createPass({
        residentId: flatId,
        guestName: name.trim(),
        guestPhone: phone.trim() || undefined,
        vehicleNo: vehicle.trim() || undefined,
        note: note.trim() || undefined,
        validFrom: from.toISOString(),
        validTo: to.toISOString(),
        maxUses: Math.max(1, Math.min(50, Number(uses) || 1)),
      });
      setName("");
      setPhone("");
      setVehicle("");
      setNote("");
      void refetch();
      const msg = shareText(flatOf(chosen.block, chosen.flat), r.code, to.toISOString());
      Alert.alert("Pass made", `Code ${r.code}. Share it with your guest.`, [{ text: "Later" }, { text: "Share", onPress: () => void Share.share({ message: msg }) }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = (p: GuestPass) =>
    Alert.alert("Cancel this pass?", `${p.guestName} won't be let in with code ${p.code}.`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel pass",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelPass(p.id);
            await refetch();
          } catch (e) {
            Alert.alert("Pass", (e as Error).message);
          }
        },
      },
    ]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title="Guest passes" subtitle="Let an expected guest in without being asked" />
        <Detail tag="A" title="New pass">
          <View style={{ gap: 12 }}>
            {flats.length > 1 && (
              <Field label="Flat">
                <Seg options={flats.map((f) => ({ value: String(f.residentId), label: flatOf(f.block, f.flat) }))} value={String(flatId ?? "")} onChange={(v) => setResidentId(Number(v))} />
              </Field>
            )}
            <Field label="Guest's name" required>
              <Input value={name} onChangeText={setName} maxLength={150} placeholder="Who is coming" />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholder="Optional" />
            </Field>
            <Field label="Vehicle number">
              <Input value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" maxLength={30} placeholder="Optional" />
            </Field>
            <Field label="Valid for">
              <Seg options={DURATIONS.map((d) => ({ value: d.value, label: d.label }))} value={duration} onChange={setDuration} />
            </Field>
            <Field label="Entries allowed">
              <Input value={uses} onChangeText={(t) => setUses(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" maxLength={2} />
            </Field>
            <Field label="Note for the guard">
              <Input value={note} onChangeText={setNote} maxLength={200} placeholder="Optional, e.g. plumber" />
            </Field>
            {error && <Notice>{error}</Notice>}
            <Key tone="ink" label={busy ? "Making…" : "Make pass"} onPress={submit} disabled={busy || !name.trim()} />
          </View>
        </Detail>
        <Detail tag="B" title="Active" note={`${active.length}`}>
          {isLoading ? <Skel h={44} /> : active.length ? active.map((p, i) => <PassRow key={p.id} p={p} last={i === active.length - 1} onCancel={cancel} />) : <Body color={S.graphite}>No active passes.</Body>}
        </Detail>
        {past.length > 0 && (
          <Detail tag="C" title="Earlier (30 days)">
            {past.map((p, i) => <PassRow key={p.id} p={p} last={i === past.length - 1} onCancel={cancel} />)}
          </Detail>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
          <Label>The guard sees the guest's name, flat, vehicle and note — not their phone number.</Label>
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
