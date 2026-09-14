// RN port of FinYearRights.tsx's FinYearDialog (web) — same fields (year
// label, start/end date, status, lock switch). Dates are plain
// YYYY-MM-DD text fields, matching every other RN form in this codebase.
// Note: mirrors a quirk in the web contract on purpose — updateFinYear's
// payload never actually sends `status` (see FinYearContext.tsx's comment:
// "status is derived from is_locked on the backend"), so the Active/Closed
// buttons here are for visual parity with web but don't get persisted
// either, same as web.
import { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, TextInput, Alert, ActivityIndicator, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, CalendarRange, CheckCircle2, Lock, Unlock } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { addFinYear, updateFinYear, type FinYear } from "@/api/finYearRightsApi";

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

export function FinYearFormModal({
  visible, editing, onClose, onSaved,
}: {
  visible: boolean;
  editing: FinYear | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"Active" | "Closed">("Active");
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setYear(editing?.year ?? "");
    setStartDate(editing?.startDate ?? "");
    setEndDate(editing?.endDate ?? "");
    setStatus(editing?.status ?? "Active");
    setLocked(editing?.locked ?? false);
  }, [visible, editing]);

  const handleSave = async () => {
    if (!year.trim()) { Alert.alert("Year required", "Give this financial year a label."); return; }
    if (!startDate.trim() || !endDate.trim()) { Alert.alert("Dates required", "Fill in both start and end dates."); return; }
    if (new Date(endDate) < new Date(startDate)) { Alert.alert("Invalid range", "End date must be on or after start date."); return; }
    setSaving(true);
    try {
      const payload = { year: year.trim(), startDate, endDate, locked };
      if (editing) await updateFinYear(editing.id, payload);
      else await addFinYear(payload);
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => !saving && onClose()}>
        <Pressable
          onPress={() => {}}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable onPress={() => !saving && onClose()} disabled={saving} style={{ position: "absolute", top: 14, right: 14, padding: 6, opacity: saving ? 0.4 : 1 }}>
              <X size={14} color={colors.mutedForeground} />
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: "#3b82f61a", alignItems: "center", justifyContent: "center" }}>
                <CalendarRange size={15} color="#3b82f6" />
              </View>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{editing ? "Edit Financial Year" : "New Financial Year"}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{editing ? `Editing ${editing.year}` : "Configure dates, status and lock"}</Text>
              </View>
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <FieldLabel required>Year Label</FieldLabel>
            <TextInput
              value={year}
              onChangeText={setYear}
              placeholder="e.g. 2025-26 or FY 2025-2026"
              placeholderTextColor={`${colors.mutedForeground}66`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14 }}
            />

            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <FieldLabel required>Start Date</FieldLabel>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={`${colors.mutedForeground}66`}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13 }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel required>End Date</FieldLabel>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={`${colors.mutedForeground}66`}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13 }}
                />
              </View>
            </View>

            <FieldLabel>Status</FieldLabel>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
              {(["Active", "Closed"] as const).map((s) => {
                const active = status === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: active ? (s === "Active" ? "#10b98166" : `${colors.mutedForeground}66`) : colors.border, backgroundColor: active ? (s === "Active" ? "#10b9811a" : `${colors.mutedForeground}1a`) : "transparent" }}
                  >
                    {s === "Active" ? <CheckCircle2 size={12} color={active ? "#10b981" : colors.mutedForeground} /> : <X size={12} color={active ? colors.mutedForeground : colors.mutedForeground} />}
                    <Text style={{ color: active ? (s === "Active" ? "#10b981" : colors.foreground) : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 12, marginBottom: 4, borderWidth: 1, borderColor: locked ? "#f59e0b4d" : colors.border, backgroundColor: locked ? "#f59e0b14" : `${colors.muted}4d` }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {locked ? <Lock size={14} color="#f59e0b" /> : <Unlock size={14} color={colors.mutedForeground} />}
                <View>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>Lock Year</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Prevents new entries when locked</Text>
                </View>
              </View>
              <Switch value={locked} onValueChange={setLocked} trackColor={{ false: colors.muted, true: "#f59e0b80" }} thumbColor={locked ? "#f59e0b" : "#f4f3f4"} />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 20, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 16 }}>
            <Pressable onPress={() => !saving && onClose()} disabled={saving} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, opacity: saving ? 0.5 : 1 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: "#2563eb", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={14} color="#fff" />}
              <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Year"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
