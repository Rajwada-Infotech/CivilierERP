// Multi-select field — a tappable row that opens a searchable checkbox sheet ("pick some people").
import { useMemo, useState } from "react";
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, type PickerOption } from "@/components/OptionPicker";

export function MultiPickerField({
  label, options, selected, onChange, placeholder = "— Select —", disabled,
}: { label: string; options: PickerOption[]; selected: string[]; onChange: (keys: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options), [options, q]);
  const names = selected.map((k) => options.find((o) => o.key === k)?.label).filter(Boolean) as string[];
  const summary = names.length === 0 ? "" : names.length <= 2 ? names.join(", ") : `${names.length} selected`;
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const close = () => { setOpen(false); setQuery(""); };

  return (
    <View>
      <PickerRow label={label} value={summary} placeholder={placeholder} disabled={disabled} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ maxHeight: "80%", backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: colors.foreground }}>{label}</Text>
              <TouchableOpacity onPress={close} style={{ padding: 4 }}><X size={18} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12 }}>
              <Search size={14} color={colors.mutedForeground} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
              {visible.length === 0 ? (
                <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>No matches.</Text>
              ) : visible.map((o) => {
                const on = selected.includes(o.key);
                return (
                  <TouchableOpacity key={o.key} onPress={() => toggle(o.key)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", borderColor: on ? "#0891b2" : colors.border, backgroundColor: on ? "#0891b2" : "transparent" }}>
                      {on && <Check size={12} color="#fff" strokeWidth={3} />}
                    </View>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={close} style={{ alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: "#0891b2" }}>
              <Text style={{ fontFamily: fonts.heading.bold, fontSize: 12, color: "#04181d" }}>Done{selected.length ? ` (${selected.length})` : ""}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
