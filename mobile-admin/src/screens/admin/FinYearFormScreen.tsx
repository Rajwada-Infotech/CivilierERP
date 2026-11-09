// RN port of FinYearRights.tsx's FinYearDialog (web), as a page on the drawing sheet like every other form here: the
// year label, start and end dates (YYYY-MM-DD, as every RN form in this codebase takes them), Active / Closed as ink
// segments, and the "Lock year" row with a square switch; Save sits in the page's own bar. Route FinYearForm takes the
// year being edited (or nothing, for a new one).
// Note: mirrors a quirk in the web contract on purpose — updateFinYear's payload never sends `status` (see
// FinYearContext.tsx: "status is derived from is_locked on the backend"), so Active / Closed is shown for parity with the
// web but isn't saved, same as the web.
import { useState } from "react";
import { View, Text, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Lock, Unlock } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { MainStackParamList } from "@/navigation/MainStack";
import { addFinYear, updateFinYear } from "@/api/finYearRightsApi";
import { Body, Field, Input, Seg } from "@/components/sheet/Sheet";
import { FormPage } from "@/components/sheet/Register";
import { SquareSwitch } from "./ApprovalSetupScreen";

export default function FinYearFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const editing = useRoute<RouteProp<MainStackParamList, "FinYearForm">>().params?.fy ?? null;

  const [year, setYear] = useState(editing?.year ?? "");
  const [startDate, setStartDate] = useState(editing?.startDate ?? "");
  const [endDate, setEndDate] = useState(editing?.endDate ?? "");
  const [status, setStatus] = useState<"Active" | "Closed">(editing?.status ?? "Active");
  const [locked, setLocked] = useState(editing?.locked ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!year.trim()) { Alert.alert("Year needed", "Give this financial year a label."); return; }
    if (!startDate.trim() || !endDate.trim()) { Alert.alert("Dates needed", "Fill in both the start and end dates."); return; }
    if (new Date(endDate) < new Date(startDate)) { Alert.alert("Dates out of order", "The end date must be on or after the start date."); return; }
    setSaving(true);
    try {
      const payload = { year: year.trim(), startDate, endDate, locked };
      if (editing) await updateFinYear(editing.id, payload);
      else await addFinYear(payload);
      setSaving(false);
      navigation.goBack();
    } catch (e: any) {
      setSaving(false);
      Alert.alert("Could not save", e?.message || "Something went wrong.");
    }
  };

  return (
    <FormPage
      asScreen
      onClose={() => navigation.goBack()}
      eyebrow="CivilierERP · Admin · Financial year"
      title={editing ? "Edit financial year" : "New financial year"}
      subtitle={editing ? `Editing ${editing.year}` : "Set its dates, status and lock."}
      saving={saving}
      onSave={handleSave}
      saveLabel={editing ? "Save changes" : "Create year"}
    >
      <View style={{ gap: 14 }}>
        <Field label="Year label" required>
          <Input value={year} onChangeText={setYear} placeholder="e.g. 2025-26 or FY 2025-2026" />
        </Field>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field label="Start date" required style={{ flex: 1 }}>
            <Input value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="End date" required style={{ flex: 1 }}>
            <Input value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" />
          </Field>
        </View>

        <Field label="Status">
          <Seg
            options={[
              { value: "Active", label: "Active" },
              { value: "Closed", label: "Closed" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: locked ? S.ink : S.line40 }}>
          {locked ? <Lock size={14} color={S.ink} /> : <Unlock size={14} color={S.graphite} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>Lock year</Text>
            <Body size={11.5} color={S.graphite}>Prevents new entries when locked</Body>
          </View>
          <SquareSwitch on={locked} onChange={setLocked} />
        </View>
      </View>
    </FormPage>
  );
}
