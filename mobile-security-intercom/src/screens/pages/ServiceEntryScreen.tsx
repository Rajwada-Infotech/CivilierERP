// Guard → Service entry: log in a vehicle or worker coming in for maintenance, a repair, a delivery or other official
// work. Unlike a visitor, no resident is asked or notified. Saved straight to the gate's log; they are logged out from
// Menu → Service entries.
import { useState } from "react";
import { ScrollView, KeyboardAvoidingView, Platform, View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Field, Input, Key, Notice, Seg, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { logServiceIn, PURPOSE_LABEL, type ServiceKind, type ServicePurpose } from "@/api/serviceEntriesApi";

const PURPOSES = Object.keys(PURPOSE_LABEL) as ServicePurpose[];

export default function ServiceEntryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ServiceKind>("VEHICLE");
  const [purpose, setPurpose] = useState<ServicePurpose>("MAINTENANCE");
  const [vehicleNo, setVehicleNo] = useState("");
  const [personName, setPersonName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [people, setPeople] = useState("1");
  const [workArea, setWorkArea] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (kind === "VEHICLE" && !vehicleNo.trim()) return setError("Enter the vehicle number.");
    if (!personName.trim()) return setError(kind === "VEHICLE" ? "Enter the driver's name." : "Enter the worker's name.");
    setSaving(true);
    try {
      const e = await logServiceIn({
        kind,
        purpose,
        personName,
        vehicleNo: kind === "VEHICLE" ? vehicleNo : undefined,
        company,
        phone,
        peopleCount: Number(people) || 1,
        workArea,
        note,
      });
      void qc.invalidateQueries({ queryKey: ["security-service-entries"] });
      Alert.alert("Logged in", `${e.kind === "VEHICLE" ? e.vehicleNo : e.personName} is in. Log them out from Service entries when they leave.`);
      navigation.replace("ServiceEntries");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
        <SheetFrame>
          <TitleBlock eyebrow="Civilier Security" title="Service entry" subtitle="Maintenance, repairs, deliveries and official work — no resident is asked" />
          <View style={{ padding: 16, gap: 14, borderTopWidth: 1, borderTopColor: S.rule }}>
            <Field label="Coming in">
              <Seg options={[{ value: "VEHICLE", label: "Vehicle" }, { value: "WORKER", label: "Worker" }]} value={kind} onChange={(v) => setKind(v as ServiceKind)} />
            </Field>
            <Field label="Here for">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Seg options={PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))} value={purpose} onChange={(v) => setPurpose(v as ServicePurpose)} />
              </ScrollView>
            </Field>
            {kind === "VEHICLE" && (
              <Field label="Vehicle number" required>
                <Input value={vehicleNo} onChangeText={setVehicleNo} placeholder="WB 02 AB 1234" autoCapitalize="characters" maxLength={20} />
              </Field>
            )}
            <Field label={kind === "VEHICLE" ? "Driver's name" : "Worker's name"} required>
              <Input value={personName} onChangeText={setPersonName} placeholder={kind === "VEHICLE" ? "Who is driving" : "Name, or the team lead's"} maxLength={120} />
            </Field>
            <Field label="Company / agency">
              <Input value={company} onChangeText={setCompany} placeholder="e.g. lift company, society office" maxLength={120} />
            </Field>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Field label="Phone" style={{ flex: 2 }}>
                <Input value={phone} onChangeText={setPhone} placeholder="Mobile" keyboardType="phone-pad" maxLength={20} />
              </Field>
              <Field label="People" style={{ flex: 1 }}>
                <Input value={people} onChangeText={(t) => setPeople(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" />
              </Field>
            </View>
            <Field label="Working at">
              <Input value={workArea} onChangeText={setWorkArea} placeholder="e.g. pump room, Block A lift, terrace" maxLength={120} />
            </Field>
            <Field label="Note">
              <Input value={note} onChangeText={setNote} placeholder="Anything to remember" maxLength={300} />
            </Field>
            {error && <Notice>{error}</Notice>}
            <Key tone="ink" label={saving ? "Logging in…" : "Log in"} icon={<LogIn size={15} color={S.paper} />} onPress={() => void save()} disabled={saving} />
            <Body size={11.5} color={S.graphite}>No resident is notified. The entry goes to the gate's log for the security office.</Body>
          </View>
        </SheetFrame>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
