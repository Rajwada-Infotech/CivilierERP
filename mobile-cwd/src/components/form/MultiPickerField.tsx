// Multi-select field — a tappable row that opens a searchable checkbox sheet ("pick some people").
import { useMemo, useState } from "react";
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Search, X } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
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
          <View style={{ maxHeight: "80%", backgroundColor: S.paper, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderWidth: 1, borderColor: S.rule, padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: S.ink }}>{label}</Text>
              <TouchableOpacity onPress={close} style={{ padding: 4 }}><X size={18} color={S.graphite} /></TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: S.rule, borderRadius: 0, paddingHorizontal: 12 }}>
              <Search size={14} color={S.graphite} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search…" placeholderTextColor={S.faint} style={{ flex: 1, color: S.ink, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
              {visible.length === 0 ? (
                <Text style={{ textAlign: "center", color: S.graphite, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>No matches.</Text>
              ) : visible.map((o) => {
                const on = selected.includes(o.key);
                return (
                  <TouchableOpacity key={o.key} onPress={() => toggle(o.key)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                    <View style={{ width: 20, height: 20, borderRadius: 0, borderWidth: 2, alignItems: "center", justifyContent: "center", borderColor: S.ink, backgroundColor: on ? S.ink : "transparent" }}>
                      {on && <Check size={12} color={S.paper} strokeWidth={3} />}
                    </View>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: S.ink }}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={close} style={{ alignItems: "center", justifyContent: "center", minHeight: 44, borderWidth: 1, borderColor: S.ink, backgroundColor: S.ink }}>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: S.paper }}>Done{selected.length ? ` (${selected.length})` : ""}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
