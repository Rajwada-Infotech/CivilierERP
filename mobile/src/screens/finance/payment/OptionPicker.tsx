// Generic bottom-sheet single-select list — shared by PaymentFormModal's
// several dropdown-style fields (company, project, bank, cheque lot, cheque
// number, card, linked invoice) so each one isn't a bespoke modal.
import { useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export interface PickerOption {
  key: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

export function PickerRow({
  label, value, placeholder = "All", onPress, disabled,
}: { label: string; value: string; placeholder?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className="flex-row items-center justify-between px-3.5 py-3 rounded-xl mb-3"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, opacity: disabled ? 0.5 : 1 }}
    >
      <View className="flex-1 min-w-0">
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: value ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 2 }}>
          {value || placeholder}
        </Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>›</Text>
    </Pressable>
  );
}

export function OptionPickerModal({
  visible, title, options, selectedKey, onSelect, onClose, searchable, clearable, loading,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
  searchable?: boolean;
  clearable?: boolean;
  loading?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "75%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          <View className="items-center pt-2 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>
          <View className="flex-row items-center justify-between px-4 py-2.5">
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} className="w-7 h-7 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {searchable && (
            <View className="mx-4 mb-2 flex-row items-center gap-2 px-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
              <Search size={13} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 8 }}
              />
            </View>
          )}

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            {clearable && (
              <Pressable onPress={() => onSelect("")} className="flex-row items-center justify-between px-4 py-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.body.medium }}>None</Text>
                {!selectedKey && <Check size={15} color={colors.primary} />}
              </Pressable>
            )}
            {loading ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>Loading…</Text>
            ) : filtered.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>No matches.</Text>
            ) : (
              filtered.map((o) => (
                <Pressable
                  key={o.key}
                  onPress={() => !o.disabled && onSelect(o.key)}
                  disabled={o.disabled}
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{ opacity: o.disabled ? 0.4 : 1 }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular }}>{o.label}</Text>
                    {!!o.sublabel && <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{o.sublabel}</Text>}
                  </View>
                  {selectedKey === o.key && <Check size={15} color={colors.primary} />}
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
